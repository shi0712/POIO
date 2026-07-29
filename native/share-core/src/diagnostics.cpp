#include "poio/share/diagnostics.hpp"

#include <Windows.h>
#include <dwmapi.h>
#include <dxgi1_6.h>
#include <mfapi.h>
#include <mfidl.h>
#include <mftransform.h>
#include <wrl/client.h>

#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Graphics.Capture.h>
#include <winrt/base.h>

#include <algorithm>
#include <array>
#include <iomanip>
#include <map>
#include <set>
#include <sstream>
#include <string_view>
#include <utility>

namespace poio::share {
namespace {

using Microsoft::WRL::ComPtr;

class ComSession {
public:
	ComSession() noexcept : result_(CoInitializeEx(nullptr, COINIT_MULTITHREADED)) {}
	~ComSession() {
		if (SUCCEEDED(result_)) {
			CoUninitialize();
		}
	}

	[[nodiscard]] bool available() const noexcept {
		return SUCCEEDED(result_) || result_ == RPC_E_CHANGED_MODE;
	}

private:
	HRESULT result_;
};

class MediaFoundationSession {
public:
	MediaFoundationSession() noexcept : result_(MFStartup(MF_VERSION, MFSTARTUP_LITE)) {}
	~MediaFoundationSession() {
		if (SUCCEEDED(result_)) {
			MFShutdown();
		}
	}

	[[nodiscard]] bool available() const noexcept {
		return SUCCEEDED(result_);
	}

private:
	HRESULT result_;
};

std::string ToUtf8(const std::wstring_view value) {
	if (value.empty()) {
		return {};
	}
	const int length = WideCharToMultiByte(
		CP_UTF8, WC_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);
	if (length <= 0) {
		return {};
	}
	std::string result(static_cast<std::size_t>(length), '\0');
	WideCharToMultiByte(CP_UTF8,
						WC_ERR_INVALID_CHARS,
						value.data(),
						static_cast<int>(value.size()),
						result.data(),
						length,
						nullptr,
						nullptr);
	return result;
}

std::string EscapeJson(const std::string_view value) {
	std::ostringstream stream;
	for (const unsigned char character : value) {
		switch (character) {
			case '"':
				stream << "\\\"";
				break;
			case '\\':
				stream << "\\\\";
				break;
			case '\b':
				stream << "\\b";
				break;
			case '\f':
				stream << "\\f";
				break;
			case '\n':
				stream << "\\n";
				break;
			case '\r':
				stream << "\\r";
				break;
			case '\t':
				stream << "\\t";
				break;
			default:
				if (character < 0x20U) {
					stream << "\\u" << std::hex << std::setw(4) << std::setfill('0')
						   << static_cast<unsigned int>(character) << std::dec << std::setfill(' ');
				} else {
					stream << static_cast<char>(character);
				}
		}
	}
	return stream.str();
}

std::string Quote(const std::string_view value) {
	return "\"" + EscapeJson(value) + "\"";
}

std::string Bool(const bool value) {
	return value ? "true" : "false";
}

std::string GuidToString(const GUID &guid) {
	std::array<wchar_t, 40> buffer{};
	if (StringFromGUID2(guid, buffer.data(), static_cast<int>(buffer.size())) <= 0) {
		return {};
	}
	return ToUtf8(buffer.data());
}

std::string LuidToString(const LUID luid) {
	std::ostringstream stream;
	stream << std::hex << std::uppercase << static_cast<std::uint32_t>(luid.HighPart) << "-"
		   << static_cast<std::uint32_t>(luid.LowPart);
	return stream.str();
}

std::string VendorName(const std::uint32_t vendorId) {
	switch (vendorId) {
		case 0x10DE:
			return "NVIDIA";
		case 0x1002:
		case 0x1022:
			return "AMD";
		case 0x8086:
			return "Intel";
		case 0x1414:
			return "Microsoft";
		default: {
			std::ostringstream stream;
			stream << "0x" << std::hex << std::uppercase << vendorId;
			return stream.str();
		}
	}
}

std::string SourceKindName(const SourceKind kind) {
	return kind == SourceKind::Monitor ? "monitor" : "window";
}

std::string ReadActivateString(IMFActivate *activate, const GUID &key) {
	wchar_t *value = nullptr;
	UINT32 length = 0;
	if (FAILED(activate->GetAllocatedString(key, &value, &length)) || value == nullptr) {
		return {};
	}
	const std::string result = ToUtf8(std::wstring_view(value, length));
	CoTaskMemFree(value);
	return result;
}

std::string ReadWindowTitle(const HWND window) {
	const int length = GetWindowTextLengthW(window);
	if (length <= 0) {
		return {};
	}
	std::wstring title(static_cast<std::size_t>(length) + 1U, L'\0');
	const int copied = GetWindowTextW(window, title.data(), static_cast<int>(title.size()));
	if (copied <= 0) {
		return {};
	}
	title.resize(static_cast<std::size_t>(copied));
	return ToUtf8(title);
}

std::string ReadApplicationName(const HWND window) {
	DWORD processId = 0;
	GetWindowThreadProcessId(window, &processId);
	if (processId == 0) {
		return {};
	}
	const HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, processId);
	if (process == nullptr) {
		return {};
	}
	std::wstring path(32768, L'\0');
	DWORD length = static_cast<DWORD>(path.size());
	const BOOL read = QueryFullProcessImageNameW(process, 0, path.data(), &length);
	CloseHandle(process);
	if (!read || length == 0) {
		return {};
	}
	path.resize(length);
	const std::size_t separator = path.find_last_of(L"\\/");
	return ToUtf8(separator == std::wstring::npos ? path : path.substr(separator + 1));
}

bool IsCapturableWindow(const HWND window) {
	if (!IsWindowVisible(window) || IsIconic(window) || GetWindow(window, GW_OWNER) != nullptr) {
		return false;
	}
	const LONG_PTR style = GetWindowLongPtrW(window, GWL_STYLE);
	const LONG_PTR extendedStyle = GetWindowLongPtrW(window, GWL_EXSTYLE);
	if ((style & WS_CHILD) != 0 || (extendedStyle & WS_EX_TOOLWINDOW) != 0) {
		return false;
	}
	DWORD cloaked = 0;
	if (SUCCEEDED(DwmGetWindowAttribute(window, DWMWA_CLOAKED, &cloaked, sizeof(cloaked))) && cloaked != 0) {
		return false;
	}
	RECT bounds{};
	if (FAILED(DwmGetWindowAttribute(window, DWMWA_EXTENDED_FRAME_BOUNDS, &bounds, sizeof(bounds)))) {
		if (!GetWindowRect(window, &bounds)) {
			return false;
		}
	}
	return bounds.right > bounds.left && bounds.bottom > bounds.top && !ReadWindowTitle(window).empty();
}

std::vector<Adapter> EnumerateAdapters(bool &desktopDuplicationAvailable) {
	std::vector<Adapter> result;
	ComPtr<IDXGIFactory6> factory;
	if (FAILED(CreateDXGIFactory1(IID_PPV_ARGS(&factory)))) {
		return result;
	}

	for (UINT index = 0;; ++index) {
		ComPtr<IDXGIAdapter1> adapter;
		const HRESULT enumerated =
			factory->EnumAdapterByGpuPreference(index, DXGI_GPU_PREFERENCE_HIGH_PERFORMANCE, IID_PPV_ARGS(&adapter));
		if (enumerated == DXGI_ERROR_NOT_FOUND) {
			break;
		}
		if (FAILED(enumerated)) {
			continue;
		}

		DXGI_ADAPTER_DESC1 description{};
		if (FAILED(adapter->GetDesc1(&description))) {
			continue;
		}

		UINT outputCount = 0;
		for (UINT outputIndex = 0;; ++outputIndex) {
			ComPtr<IDXGIOutput> output;
			if (adapter->EnumOutputs(outputIndex, &output) == DXGI_ERROR_NOT_FOUND) {
				break;
			}
			if (output) {
				++outputCount;
				ComPtr<IDXGIOutput1> duplicationOutput;
				if (SUCCEEDED(output.As(&duplicationOutput))) {
					desktopDuplicationAvailable = true;
				}
			}
		}

		result.push_back(Adapter{
			.id = "adapter:" + LuidToString(description.AdapterLuid),
			.name = ToUtf8(description.Description),
			.vendor = VendorName(description.VendorId),
			.vendorId = description.VendorId,
			.deviceId = description.DeviceId,
			.dedicatedVideoMemory = static_cast<std::uint64_t>(description.DedicatedVideoMemory),
			.software = (description.Flags & DXGI_ADAPTER_FLAG_SOFTWARE) != 0,
			.outputCount = outputCount,
		});
	}
	return result;
}

void AppendEncodersForInput(const GUID &inputSubtype,
							const std::string_view inputName,
							std::map<std::string, Encoder> &encoders) {
	MFT_REGISTER_TYPE_INFO input{ MFMediaType_Video, inputSubtype };
	MFT_REGISTER_TYPE_INFO output{ MFMediaType_Video, MFVideoFormat_H264 };
	IMFActivate **activates = nullptr;
	UINT32 count = 0;
	const UINT32 flags = MFT_ENUM_FLAG_HARDWARE | MFT_ENUM_FLAG_SORTANDFILTER;
	if (FAILED(MFTEnumEx(MFT_CATEGORY_VIDEO_ENCODER, flags, &input, &output, &activates, &count))) {
		return;
	}
	for (UINT32 index = 0; index < count; ++index) {
		IMFActivate *activate = activates[index];
		if (activate == nullptr) {
			continue;
		}
		GUID transformId{};
		const bool hasId =
			SUCCEEDED(activate->GetGUID(MFT_TRANSFORM_CLSID_Attribute, &transformId));
		const std::string name = ReadActivateString(activate, MFT_FRIENDLY_NAME_Attribute);
		const std::string id = hasId ? GuidToString(transformId) : name;
		if (!id.empty()) {
			auto [iterator, inserted] = encoders.try_emplace(
				id,
				Encoder{
					.id = "mft:" + id,
					.name = name.empty() ? "Hardware H.264 encoder" : name,
					.hardwareUrl = ReadActivateString(activate, MFT_ENUM_HARDWARE_URL_Attribute),
					.inputFormat = std::string(inputName),
					.outputFormat = "H264",
					.hardware = true,
				});
			if (!inserted && iterator->second.inputFormat.find(inputName) == std::string::npos) {
				iterator->second.inputFormat += "," + std::string(inputName);
			}
		}
		activate->Release();
	}
	CoTaskMemFree(activates);
}

std::vector<Encoder> EnumerateHardwareEncoders() {
	std::map<std::string, Encoder> encoders;
	AppendEncodersForInput(MFVideoFormat_NV12, "NV12", encoders);
	AppendEncodersForInput(MFVideoFormat_ARGB32, "ARGB32", encoders);
	std::vector<Encoder> result;
	result.reserve(encoders.size());
	for (auto &[id, encoder] : encoders) {
		result.push_back(std::move(encoder));
	}
	return result;
}

BOOL CALLBACK MonitorCallback(const HMONITOR monitor, HDC, LPRECT, const LPARAM context) {
	auto &sources = *reinterpret_cast<std::vector<Source> *>(context);
	MONITORINFOEXW info{};
	info.cbSize = sizeof(info);
	if (!GetMonitorInfoW(monitor, &info)) {
		return TRUE;
	}
	const RECT &bounds = info.rcMonitor;
	const std::string device = ToUtf8(info.szDevice);
	sources.push_back(Source{
		.id = "monitor:" + device,
		.kind = SourceKind::Monitor,
		.name = device,
		.application = "Windows display",
		.bounds =
			Rect{
				.x = bounds.left,
				.y = bounds.top,
				.width = bounds.right - bounds.left,
				.height = bounds.bottom - bounds.top,
			},
		.primary = (info.dwFlags & MONITORINFOF_PRIMARY) != 0,
		.captureSupported = true,
	});
	return TRUE;
}

BOOL CALLBACK WindowCallback(const HWND window, const LPARAM context) {
	if (!IsCapturableWindow(window)) {
		return TRUE;
	}
	auto &sources = *reinterpret_cast<std::vector<Source> *>(context);
	RECT bounds{};
	if (FAILED(DwmGetWindowAttribute(window, DWMWA_EXTENDED_FRAME_BOUNDS, &bounds, sizeof(bounds)))) {
		GetWindowRect(window, &bounds);
	}
	std::ostringstream id;
	id << "window:0x" << std::hex << std::uppercase << reinterpret_cast<std::uintptr_t>(window);
	sources.push_back(Source{
		.id = id.str(),
		.kind = SourceKind::Window,
		.name = ReadWindowTitle(window),
		.application = ReadApplicationName(window),
		.bounds =
			Rect{
				.x = bounds.left,
				.y = bounds.top,
				.width = bounds.right - bounds.left,
				.height = bounds.bottom - bounds.top,
			},
		.primary = false,
		.captureSupported = true,
	});
	return TRUE;
}

std::vector<Source> EnumerateSources() {
	std::vector<Source> result;
	EnumDisplayMonitors(nullptr, nullptr, MonitorCallback, reinterpret_cast<LPARAM>(&result));
	EnumWindows(WindowCallback, reinterpret_cast<LPARAM>(&result));
	return result;
}

bool IsWindowsGraphicsCaptureSupported() {
	try {
		return winrt::Windows::Graphics::Capture::GraphicsCaptureSession::IsSupported();
	} catch (...) {
		return false;
	}
}

std::string ReadOsVersion() {
	using RtlGetVersionFn = LONG(WINAPI *)(PRTL_OSVERSIONINFOW);
	const HMODULE ntdll = GetModuleHandleW(L"ntdll.dll");
	if (ntdll == nullptr) {
		return "Windows";
	}
	const auto getVersion = reinterpret_cast<RtlGetVersionFn>(GetProcAddress(ntdll, "RtlGetVersion"));
	if (getVersion == nullptr) {
		return "Windows";
	}
	RTL_OSVERSIONINFOW version{};
	version.dwOSVersionInfoSize = sizeof(version);
	if (getVersion(&version) != 0) {
		return "Windows";
	}
	std::ostringstream result;
	result << "Windows " << version.dwMajorVersion << "." << version.dwMinorVersion << " build "
		   << version.dwBuildNumber;
	return result.str();
}

std::string SerializeRect(const Rect &rect) {
	std::ostringstream json;
	json << "{\"x\":" << rect.x << ",\"y\":" << rect.y << ",\"width\":" << rect.width
		 << ",\"height\":" << rect.height << "}";
	return json.str();
}

std::string SerializeAdapter(const Adapter &adapter) {
	std::ostringstream json;
	json << "{\"id\":" << Quote(adapter.id) << ",\"name\":" << Quote(adapter.name)
		 << ",\"vendor\":" << Quote(adapter.vendor) << ",\"vendorId\":" << adapter.vendorId
		 << ",\"deviceId\":" << adapter.deviceId << ",\"dedicatedVideoMemory\":"
		 << adapter.dedicatedVideoMemory << ",\"software\":" << Bool(adapter.software)
		 << ",\"outputCount\":" << adapter.outputCount << "}";
	return json.str();
}

std::string SerializeEncoder(const Encoder &encoder) {
	std::ostringstream json;
	json << "{\"id\":" << Quote(encoder.id) << ",\"name\":" << Quote(encoder.name)
		 << ",\"hardwareUrl\":" << Quote(encoder.hardwareUrl) << ",\"inputFormat\":"
		 << Quote(encoder.inputFormat) << ",\"outputFormat\":" << Quote(encoder.outputFormat)
		 << ",\"hardware\":" << Bool(encoder.hardware) << "}";
	return json.str();
}

std::string SerializeSource(const Source &source) {
	std::ostringstream json;
	json << "{\"id\":" << Quote(source.id) << ",\"kind\":" << Quote(SourceKindName(source.kind))
		 << ",\"name\":" << Quote(source.name) << ",\"application\":" << Quote(source.application)
		 << ",\"bounds\":" << SerializeRect(source.bounds) << ",\"primary\":" << Bool(source.primary)
		 << ",\"captureSupported\":" << Bool(source.captureSupported) << "}";
	return json.str();
}

template<typename Value, typename Serializer>
std::string SerializeArray(const std::vector<Value> &values, Serializer serializer) {
	std::ostringstream json;
	json << "[";
	for (std::size_t index = 0; index < values.size(); ++index) {
		if (index != 0) {
			json << ",";
		}
		json << serializer(values[index]);
	}
	json << "]";
	return json.str();
}

} // namespace

ProbeReport ProbeSystem() {
	ProbeReport report;
	report.osVersion = ReadOsVersion();

	const ComSession com;
	if (!com.available()) {
		report.warnings.emplace_back("COM initialization failed");
	}

	report.capabilities.windowsGraphicsCapture = IsWindowsGraphicsCaptureSupported();
	report.adapters = EnumerateAdapters(report.capabilities.desktopDuplication);
	report.sources = EnumerateSources();

	const MediaFoundationSession mediaFoundation;
	report.capabilities.mediaFoundation = mediaFoundation.available();
	if (mediaFoundation.available()) {
		report.encoders = EnumerateHardwareEncoders();
		report.capabilities.hardwareH264 = !report.encoders.empty();
	} else {
		report.warnings.emplace_back("Media Foundation initialization failed");
	}

	if (!report.capabilities.windowsGraphicsCapture) {
		report.warnings.emplace_back("Windows Graphics Capture is unavailable");
	}
	if (!report.capabilities.desktopDuplication) {
		report.warnings.emplace_back("DXGI Desktop Duplication is unavailable");
	}
	if (!report.capabilities.hardwareH264) {
		report.warnings.emplace_back("No Media Foundation hardware H.264 encoder was found");
	}
	return report;
}

std::string SerializeAdapters(const ProbeReport &report) {
	return SerializeArray(report.adapters, SerializeAdapter);
}

std::string SerializeEncoders(const ProbeReport &report) {
	return SerializeArray(report.encoders, SerializeEncoder);
}

std::string SerializeSources(const ProbeReport &report) {
	return SerializeArray(report.sources, SerializeSource);
}

std::string SerializeReport(const ProbeReport &report) {
	std::ostringstream json;
	json << "{\"schema\":" << Quote(report.schema) << ",\"coreVersion\":" << Quote(report.coreVersion)
		 << ",\"platform\":" << Quote(report.platform) << ",\"osVersion\":" << Quote(report.osVersion)
		 << ",\"capabilities\":{\"windowsGraphicsCapture\":"
		 << Bool(report.capabilities.windowsGraphicsCapture)
		 << ",\"desktopDuplication\":" << Bool(report.capabilities.desktopDuplication)
		 << ",\"mediaFoundation\":" << Bool(report.capabilities.mediaFoundation)
		 << ",\"hardwareH264\":" << Bool(report.capabilities.hardwareH264) << "},\"adapters\":"
		 << SerializeAdapters(report) << ",\"encoders\":" << SerializeEncoders(report)
		 << ",\"sources\":" << SerializeSources(report) << ",\"warnings\":"
		 << SerializeArray(report.warnings, [](const std::string &warning) { return Quote(warning); }) << "}";
	return json.str();
}

} // namespace poio::share
