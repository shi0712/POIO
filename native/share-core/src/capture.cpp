#include "poio/share/capture.hpp"
#include "poio/share/encoder.hpp"
#include "poio/share/h264.hpp"

#include <Windows.h>
#include <codecapi.h>
#include <d3d11.h>
#include <d3d11_1.h>
#include <dxgi1_2.h>
#include <icodecapi.h>
#include <mfapi.h>
#include <mferror.h>
#include <mfidl.h>
#include <mftransform.h>
#include <windows.graphics.capture.interop.h>
#include <windows.graphics.directx.direct3d11.interop.h>
#include <wrl/client.h>

#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Graphics.Capture.h>
#include <winrt/Windows.Graphics.DirectX.Direct3D11.h>
#include <winrt/Windows.Graphics.DirectX.h>
#include <winrt/Windows.Graphics.h>
#include <winrt/base.h>

#include <algorithm>
#include <array>
#include <atomic>
#include <chrono>
#include <cmath>
#include <condition_variable>
#include <cstdint>
#include <iomanip>
#include <mutex>
#include <numeric>
#include <map>
#include <optional>
#include <sstream>
#include <stdexcept>
#include <string_view>
#include <thread>
#include <vector>

namespace poio::share {
namespace {

using Microsoft::WRL::ComPtr;
using Clock = std::chrono::steady_clock;
using winrt::Windows::Graphics::Capture::Direct3D11CaptureFramePool;
using winrt::Windows::Graphics::Capture::GraphicsCaptureItem;
using winrt::Windows::Graphics::Capture::GraphicsCaptureSession;
using winrt::Windows::Graphics::DirectX::Direct3D11::IDirect3DDevice;
using winrt::Windows::Graphics::DirectX::DirectXPixelFormat;

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
	MediaFoundationSession() noexcept : result_(MFStartup(MF_VERSION, MFSTARTUP_FULL)) {}
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

struct MonitorSearch {
	std::wstring device;
	HMONITOR monitor = nullptr;
};

BOOL CALLBACK FindMonitorCallback(const HMONITOR monitor, HDC, LPRECT, const LPARAM context) {
	auto &search = *reinterpret_cast<MonitorSearch *>(context);
	MONITORINFOEXW info{};
	info.cbSize = sizeof(info);
	if (GetMonitorInfoW(monitor, &info) && search.device == info.szDevice) {
		search.monitor = monitor;
		return FALSE;
	}
	return TRUE;
}

std::wstring ToWide(const std::string_view value) {
	if (value.empty()) {
		return {};
	}
	const int length = MultiByteToWideChar(
		CP_UTF8, MB_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()), nullptr, 0);
	if (length <= 0) {
		return {};
	}
	std::wstring result(static_cast<std::size_t>(length), L'\0');
	MultiByteToWideChar(CP_UTF8,
						MB_ERR_INVALID_CHARS,
						value.data(),
						static_cast<int>(value.size()),
						result.data(),
						length);
	return result;
}

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

std::string FormatHresult(const HRESULT result) {
	std::ostringstream stream;
	stream << "0x" << std::hex << std::uppercase << static_cast<std::uint32_t>(result);
	return stream.str();
}

double Milliseconds(const Clock::duration duration) {
	return std::chrono::duration<double, std::milli>(duration).count();
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

std::string DxgiFormatName(const DXGI_FORMAT format) {
	switch (format) {
		case DXGI_FORMAT_B8G8R8A8_UNORM:
			return "B8G8R8A8_UNORM";
		case DXGI_FORMAT_R8G8B8A8_UNORM:
			return "R8G8B8A8_UNORM";
		case DXGI_FORMAT_R10G10B10A2_UNORM:
			return "R10G10B10A2_UNORM";
		case DXGI_FORMAT_R16G16B16A16_FLOAT:
			return "R16G16B16A16_FLOAT";
		default:
			return "DXGI_FORMAT_" + std::to_string(static_cast<std::uint32_t>(format));
	}
}

std::string AdapterName(ID3D11Device *device) {
	ComPtr<IDXGIDevice> dxgiDevice;
	if (FAILED(device->QueryInterface(IID_PPV_ARGS(&dxgiDevice)))) {
		return {};
	}
	ComPtr<IDXGIAdapter> adapter;
	if (FAILED(dxgiDevice->GetAdapter(&adapter))) {
		return {};
	}
	DXGI_ADAPTER_DESC description{};
	if (FAILED(adapter->GetDesc(&description))) {
		return {};
	}
	return ToUtf8(description.Description);
}

IDirect3DDevice CreateCaptureDevice(ComPtr<ID3D11Device> &nativeDevice) {
	UINT flags = D3D11_CREATE_DEVICE_BGRA_SUPPORT | D3D11_CREATE_DEVICE_VIDEO_SUPPORT;
#if defined(_DEBUG)
	flags |= D3D11_CREATE_DEVICE_DEBUG;
#endif
	const std::array featureLevels{
		D3D_FEATURE_LEVEL_11_1,
		D3D_FEATURE_LEVEL_11_0,
		D3D_FEATURE_LEVEL_10_1,
		D3D_FEATURE_LEVEL_10_0,
	};
	D3D_FEATURE_LEVEL selectedFeatureLevel{};
	ComPtr<ID3D11DeviceContext> context;
	HRESULT result = D3D11CreateDevice(nullptr,
									  D3D_DRIVER_TYPE_HARDWARE,
									  nullptr,
									  flags,
									  featureLevels.data(),
									  static_cast<UINT>(featureLevels.size()),
									  D3D11_SDK_VERSION,
									  &nativeDevice,
									  &selectedFeatureLevel,
									  &context);
	if (result == E_INVALIDARG) {
		result = D3D11CreateDevice(nullptr,
								   D3D_DRIVER_TYPE_HARDWARE,
								   nullptr,
								   flags,
								   featureLevels.data() + 1,
								   static_cast<UINT>(featureLevels.size() - 1),
								   D3D11_SDK_VERSION,
								   &nativeDevice,
								   &selectedFeatureLevel,
								   &context);
	}
	winrt::check_hresult(result);
	ComPtr<ID3D10Multithread> multithread;
	if (SUCCEEDED(context.As(&multithread))) {
		multithread->SetMultithreadProtected(TRUE);
	}

	ComPtr<IDXGIDevice> dxgiDevice;
	winrt::check_hresult(nativeDevice.As(&dxgiDevice));
	winrt::com_ptr<IInspectable> inspectableDevice;
	winrt::check_hresult(CreateDirect3D11DeviceFromDXGIDevice(dxgiDevice.Get(), inspectableDevice.put()));
	return inspectableDevice.as<IDirect3DDevice>();
}

ComPtr<IMFMediaType> CreateVideoType(const GUID &subtype,
									const std::uint32_t width,
									const std::uint32_t height,
									const std::uint32_t frameRate,
									const std::uint32_t bitrate) {
	ComPtr<IMFMediaType> type;
	winrt::check_hresult(MFCreateMediaType(&type));
	winrt::check_hresult(type->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video));
	winrt::check_hresult(type->SetGUID(MF_MT_SUBTYPE, subtype));
	winrt::check_hresult(MFSetAttributeSize(type.Get(), MF_MT_FRAME_SIZE, width, height));
	winrt::check_hresult(MFSetAttributeRatio(type.Get(), MF_MT_FRAME_RATE, frameRate, 1));
	winrt::check_hresult(MFSetAttributeRatio(type.Get(), MF_MT_PIXEL_ASPECT_RATIO, 1, 1));
	winrt::check_hresult(type->SetUINT32(MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive));
	if (bitrate != 0) {
		winrt::check_hresult(type->SetUINT32(MF_MT_AVG_BITRATE, bitrate));
	}
	return type;
}

bool SetCodecUInt32(ICodecAPI *codec, const GUID &key, const std::uint32_t value) {
	if (codec == nullptr) {
		return false;
	}
	VARIANT setting;
	VariantInit(&setting);
	setting.vt = VT_UI4;
	setting.ulVal = value;
	return SUCCEEDED(codec->SetValue(&key, &setting));
}

void RecordNalType(const BYTE *data,
				   const std::size_t length,
				   EncodeBenchmarkResult &result) {
	if (data == nullptr || length == 0) {
		return;
	}
	const std::uint8_t type = data[0] & 0x1FU;
	if (type == 7) {
		++result.spsUnits;
		if (length >= 4 && result.spsProfileIdc == 0) {
			result.spsProfileIdc = data[1];
			result.spsConstraintFlags = data[2];
			result.spsLevelIdc = data[3];
		}
	} else if (type == 8) {
		++result.ppsUnits;
	} else if (type == 5) {
		++result.idrUnits;
	}
}

bool ParseAnnexB(const BYTE *data, const std::size_t length, EncodeBenchmarkResult &result) {
	bool found = false;
	for (std::size_t offset = 0; offset + 3 < length;) {
		std::size_t startCodeLength = 0;
		if (data[offset] == 0 && data[offset + 1] == 0 && data[offset + 2] == 1) {
			startCodeLength = 3;
		} else if (offset + 4 < length && data[offset] == 0 && data[offset + 1] == 0 &&
				   data[offset + 2] == 0 && data[offset + 3] == 1) {
			startCodeLength = 4;
		}
		if (startCodeLength == 0) {
			++offset;
			continue;
		}
		const std::size_t nalOffset = offset + startCodeLength;
		if (nalOffset < length) {
			std::size_t nextOffset = nalOffset + 1;
			while (nextOffset < length) {
				const bool threeByteStart =
					nextOffset + 2 < length && data[nextOffset] == 0 &&
					data[nextOffset + 1] == 0 && data[nextOffset + 2] == 1;
				const bool fourByteStart =
					nextOffset + 3 < length && data[nextOffset] == 0 &&
					data[nextOffset + 1] == 0 && data[nextOffset + 2] == 0 &&
					data[nextOffset + 3] == 1;
				if (threeByteStart || fourByteStart) {
					break;
				}
				++nextOffset;
			}
			RecordNalType(data + nalOffset, nextOffset - nalOffset, result);
			found = true;
		}
		offset = nalOffset + 1;
	}
	return found;
}

bool ParseAvcc(const BYTE *data, const std::size_t length, EncodeBenchmarkResult &result) {
	bool found = false;
	std::size_t offset = 0;
	while (offset + 4 <= length) {
		const std::uint32_t nalLength = (static_cast<std::uint32_t>(data[offset]) << 24U) |
									   (static_cast<std::uint32_t>(data[offset + 1]) << 16U) |
									   (static_cast<std::uint32_t>(data[offset + 2]) << 8U) |
									   static_cast<std::uint32_t>(data[offset + 3]);
		offset += 4;
		if (nalLength == 0 || nalLength > length - offset) {
			return false;
		}
		RecordNalType(data + offset, nalLength, result);
		found = true;
		offset += nalLength;
	}
	return found && offset == length;
}

class HardwareH264Encoder {
public:
	HardwareH264Encoder(ID3D11Device *device,
						const std::string &adapter,
						const EncodeBenchmarkOptions &options,
						const std::uint32_t width,
						const std::uint32_t height,
						EncodeBenchmarkResult &result)
		: options_(options),
		  result_(result),
		  callback_(options.onEncodedAccessUnit),
		  width_(width),
		  height_(height),
		  frameDuration_(10'000'000LL / options.frameRate) {
		ActivateEncoder(adapter);
		Configure(device, width, height);
	}

	~HardwareH264Encoder() {
		if (transform_) {
			transform_->ProcessMessage(MFT_MESSAGE_NOTIFY_END_STREAMING, 0);
		}
	}

	void Encode(ID3D11Texture2D *texture,
				const Clock::time_point capturedAt,
				const std::optional<std::uint32_t> rtpTimestamp90Khz = std::nullopt) {
		if (texture == nullptr) {
			throw std::runtime_error("Capture returned an empty D3D11 texture");
		}
		DrainEvents();
		ProcessAvailableOutputs();
		if (asynchronous_) {
			const Clock::time_point deadline = Clock::now() + std::chrono::milliseconds(25);
			while (needInput_ == 0 && Clock::now() < deadline) {
				DrainEvents();
				ProcessAvailableOutputs();
				if (needInput_ == 0) {
					Sleep(0);
				}
			}
			if (needInput_ == 0) {
				throw std::runtime_error("Hardware encoder did not request an input frame");
			}
		}

		ComPtr<IMFMediaBuffer> surfaceBuffer;
		const HRESULT surfaceResult =
			MFCreateDXGISurfaceBuffer(__uuidof(ID3D11Texture2D), texture, 0, FALSE, &surfaceBuffer);
		if (FAILED(surfaceResult)) {
			throw std::runtime_error("MFCreateDXGISurfaceBuffer failed: " + FormatHresult(surfaceResult));
		}
		result_.gpuSurfaceInput = true;

		ComPtr<IMFSample> sample;
		winrt::check_hresult(MFCreateSample(&sample));
		winrt::check_hresult(sample->AddBuffer(surfaceBuffer.Get()));
		const LONGLONG sampleTime = static_cast<LONGLONG>(submittedFrames_) * frameDuration_;
		winrt::check_hresult(sample->SetSampleTime(sampleTime));
		winrt::check_hresult(sample->SetSampleDuration(frameDuration_));
		if (submittedFrames_ == 0) {
			sample->SetUINT32(MFSampleExtension_Discontinuity, TRUE);
		}
		if (!dynamicBitrateAttempted_ && submittedFrames_ >= options_.targetFrames / 3) {
			dynamicBitrateAttempted_ = true;
			result_.dynamicBitrateSupported = SetTargetBitrate(options_.bitrate);
		}
		if (!forceKeyFrameAttempted_ && submittedFrames_ >= options_.targetFrames / 2) {
			forceKeyFrameAttempted_ = true;
			result_.forceKeyFrameSupported = RequestKeyFrame();
		}

		HRESULT processResult = transform_->ProcessInput(inputStreamId_, sample.Get(), 0);
		if (processResult == MF_E_NOTACCEPTING) {
			DrainEvents();
			ProcessAvailableOutputs();
			processResult = transform_->ProcessInput(inputStreamId_, sample.Get(), 0);
		}
		if (FAILED(processResult)) {
			throw std::runtime_error("Hardware encoder rejected a GPU frame: " + FormatHresult(processResult));
		}
		if (asynchronous_ && needInput_ > 0) {
			--needInput_;
		}
		submittedAt_[sampleTime] = SubmittedFrame{
			.capturedAt = capturedAt,
			.rtpTimestamp90Khz = rtpTimestamp90Khz,
		};
		++submittedFrames_;
		result_.submittedFrames = submittedFrames_;

		DrainEvents();
		ProcessAvailableOutputs();
		if (!asynchronous_) {
			ProcessSynchronousOutputs();
		}
	}

	void Finish() {
		transform_->ProcessMessage(MFT_MESSAGE_NOTIFY_END_OF_STREAM, inputStreamId_);
		transform_->ProcessMessage(MFT_MESSAGE_COMMAND_DRAIN, 0);
		const Clock::time_point deadline = Clock::now() + std::chrono::seconds(3);
		for (;;) {
			DrainEvents();
			ProcessAvailableOutputs();
			if (!asynchronous_) {
				ProcessSynchronousOutputs();
				break;
			}
			if ((drainComplete_ && haveOutput_ == 0) || Clock::now() >= deadline) {
				break;
			}
			Sleep(1);
		}
		if (asynchronous_ && !drainComplete_) {
			throw std::runtime_error("Hardware encoder drain timed out");
		}
	}

	void Pump() {
		DrainEvents();
		ProcessAvailableOutputs();
	}

	[[nodiscard]] bool SetTargetBitrate(const std::uint32_t bitrate) {
		const bool supported =
			SetCodecUInt32(codec_.Get(), CODECAPI_AVEncCommonMeanBitRate, bitrate);
		result_.dynamicBitrateSupported = result_.dynamicBitrateSupported || supported;
		if (supported) {
			result_.configuredBitrate = bitrate;
		}
		return supported;
	}

	[[nodiscard]] bool RequestKeyFrame() {
		const bool supported =
			SetCodecUInt32(codec_.Get(), CODECAPI_AVEncVideoForceKeyFrame, TRUE);
		result_.forceKeyFrameSupported = result_.forceKeyFrameSupported || supported;
		return supported;
	}

private:
	void ActivateEncoder(const std::string &adapter) {
		MFT_REGISTER_TYPE_INFO input{ MFMediaType_Video, MFVideoFormat_ARGB32 };
		MFT_REGISTER_TYPE_INFO output{ MFMediaType_Video, MFVideoFormat_H264 };
		IMFActivate **activates = nullptr;
		UINT32 count = 0;
		const HRESULT enumerationResult = MFTEnumEx(
			MFT_CATEGORY_VIDEO_ENCODER,
			MFT_ENUM_FLAG_HARDWARE | MFT_ENUM_FLAG_SORTANDFILTER,
			&input,
			&output,
			&activates,
			&count);
		if (FAILED(enumerationResult) || count == 0) {
			CoTaskMemFree(activates);
			throw std::runtime_error("No ARGB32-capable hardware H.264 encoder was found");
		}

		UINT32 selected = 0;
		for (UINT32 index = 0; index < count; ++index) {
			const std::string candidate = ReadActivateString(activates[index], MFT_FRIENDLY_NAME_Attribute);
			const bool nvidiaMatch =
				adapter.find("NVIDIA") != std::string::npos && candidate.find("NVIDIA") != std::string::npos;
			const bool amdMatch =
				adapter.find("AMD") != std::string::npos && candidate.find("AMD") != std::string::npos;
			const bool intelMatch =
				adapter.find("Intel") != std::string::npos && candidate.find("Intel") != std::string::npos;
			if (nvidiaMatch || amdMatch || intelMatch) {
				selected = index;
				break;
			}
		}

		result_.encoderName = ReadActivateString(activates[selected], MFT_FRIENDLY_NAME_Attribute);
		const HRESULT activationResult = activates[selected]->ActivateObject(IID_PPV_ARGS(&transform_));
		for (UINT32 index = 0; index < count; ++index) {
			activates[index]->Release();
		}
		CoTaskMemFree(activates);
		if (FAILED(activationResult)) {
			throw std::runtime_error("Hardware encoder activation failed: " + FormatHresult(activationResult));
		}
	}

	void Configure(ID3D11Device *device, const std::uint32_t width, const std::uint32_t height) {
		DWORD inputCount = 0;
		DWORD outputCount = 0;
		winrt::check_hresult(transform_->GetStreamCount(&inputCount, &outputCount));
		if (inputCount != 1 || outputCount != 1) {
			throw std::runtime_error("Unexpected hardware encoder stream layout");
		}
		DWORD inputId = 0;
		DWORD outputId = 0;
		if (SUCCEEDED(transform_->GetStreamIDs(1, &inputId, 1, &outputId))) {
			inputStreamId_ = inputId;
			outputStreamId_ = outputId;
		}

		ComPtr<IMFAttributes> attributes;
		winrt::check_hresult(transform_->GetAttributes(&attributes));
		UINT32 value = FALSE;
		if (SUCCEEDED(attributes->GetUINT32(MF_TRANSFORM_ASYNC, &value)) && value != FALSE) {
			asynchronous_ = true;
			result_.asynchronous = true;
			winrt::check_hresult(attributes->SetUINT32(MF_TRANSFORM_ASYNC_UNLOCK, TRUE));
			winrt::check_hresult(transform_.As(&eventGenerator_));
		}
		value = FALSE;
		if (SUCCEEDED(attributes->GetUINT32(MF_SA_D3D11_AWARE, &value)) && value != FALSE) {
			result_.d3d11Aware = true;
		}
		result_.lowLatencyEnabled = SUCCEEDED(attributes->SetUINT32(MF_LOW_LATENCY, TRUE));

		UINT resetToken = 0;
		winrt::check_hresult(MFCreateDXGIDeviceManager(&resetToken, &deviceManager_));
		winrt::check_hresult(deviceManager_->ResetDevice(device, resetToken));
		winrt::check_hresult(transform_->ProcessMessage(
			MFT_MESSAGE_SET_D3D_MANAGER, reinterpret_cast<ULONG_PTR>(deviceManager_.Get())));

		const auto outputType =
			CreateVideoType(MFVideoFormat_H264, width, height, options_.frameRate, options_.bitrate);
		UINT32 mediaFoundationProfile = eAVEncH264VProfile_High;
		if (options_.profile == H264Profile::ConstrainedBaseline) {
			mediaFoundationProfile = eAVEncH264VProfile_ConstrainedBase;
		} else if (options_.profile == H264Profile::Main) {
			mediaFoundationProfile = eAVEncH264VProfile_Main;
		}
		outputType->SetUINT32(MF_MT_MPEG2_PROFILE, mediaFoundationProfile);
		winrt::check_hresult(transform_->SetOutputType(outputStreamId_, outputType.Get(), 0));

		const auto inputType =
			CreateVideoType(MFVideoFormat_ARGB32, width, height, options_.frameRate, 0);
		winrt::check_hresult(transform_->SetInputType(inputStreamId_, inputType.Get(), 0));

		transform_.As(&codec_);
		const bool codecLowLatency = SetCodecUInt32(codec_.Get(), CODECAPI_AVLowLatencyMode, TRUE);
		result_.lowLatencyEnabled = result_.lowLatencyEnabled || codecLowLatency;
		SetCodecUInt32(codec_.Get(),
					   CODECAPI_AVEncCommonRateControlMode,
					   eAVEncCommonRateControlMode_LowDelayVBR);
		SetCodecUInt32(codec_.Get(), CODECAPI_AVEncCommonMeanBitRate, options_.bitrate);
		SetCodecUInt32(codec_.Get(), CODECAPI_AVEncMPVGOPSize, options_.keyFrameInterval);
		SetCodecUInt32(codec_.Get(), CODECAPI_AVEncMPVDefaultBPictureCount, 0);
		SetCodecUInt32(codec_.Get(), CODECAPI_AVEncCommonRealTime, TRUE);
		SetCodecUInt32(codec_.Get(), CODECAPI_AVEncCommonAllowFrameDrops, FALSE);
		SetCodecUInt32(
			codec_.Get(),
			CODECAPI_AVScenarioInfo,
			eAVScenarioInfo_DisplayRemoting);
		SetCodecUInt32(
			codec_.Get(),
			CODECAPI_VideoEncoderDisplayContentType,
			options_.contentMode == ScreenContentMode::Motion
				? eVideoEncoderDisplayContent_FullScreenVideo
				: eVideoEncoderDisplayContent_Unknown);
		SetCodecUInt32(
			codec_.Get(),
			CODECAPI_AVEncCommonQualityVsSpeed,
			// Microsoft defines larger values as higher quality (and slower
			// encoding). Text/detail mode can spend more GPU time to retain
			// fine edges, while motion mode keeps enough headroom for 60 fps.
			options_.contentMode == ScreenContentMode::Motion ? 75U : 90U);
		SetCodecUInt32(
			codec_.Get(),
			CODECAPI_AVEncVideoEnableSpatialAdaptiveQuantization,
			TRUE);
		SetCodecUInt32(codec_.Get(), CODECAPI_AVEncVideoMaxNumRefFrame, 1);
		SetCodecUInt32(codec_.Get(), CODECAPI_AVEnableInLoopDeblockFilter, TRUE);

		winrt::check_hresult(transform_->GetOutputStreamInfo(outputStreamId_, &outputStreamInfo_));
		winrt::check_hresult(transform_->ProcessMessage(MFT_MESSAGE_NOTIFY_BEGIN_STREAMING, 0));
		winrt::check_hresult(transform_->ProcessMessage(MFT_MESSAGE_NOTIFY_START_OF_STREAM, 0));
		if (asynchronous_) {
			const Clock::time_point deadline = Clock::now() + std::chrono::seconds(1);
			while (needInput_ == 0 && Clock::now() < deadline) {
				DrainEvents();
				if (needInput_ == 0) {
					Sleep(1);
				}
			}
			if (needInput_ == 0) {
				throw std::runtime_error("Hardware encoder did not start its input stream");
			}
		}
	}

	void DrainEvents() {
		if (!asynchronous_) {
			return;
		}
		for (;;) {
			ComPtr<IMFMediaEvent> event;
			const HRESULT eventResult = eventGenerator_->GetEvent(MF_EVENT_FLAG_NO_WAIT, &event);
			if (eventResult == MF_E_NO_EVENTS_AVAILABLE) {
				break;
			}
			winrt::check_hresult(eventResult);
			MediaEventType type = MEUnknown;
			winrt::check_hresult(event->GetType(&type));
			HRESULT status = S_OK;
			event->GetStatus(&status);
			winrt::check_hresult(status);
			if (type == METransformNeedInput) {
				++needInput_;
			} else if (type == METransformHaveOutput) {
				++haveOutput_;
			} else if (type == METransformDrainComplete) {
				drainComplete_ = true;
			}
		}
	}

	ComPtr<IMFSample> CreateOutputSample() const {
		if ((outputStreamInfo_.dwFlags & MFT_OUTPUT_STREAM_PROVIDES_SAMPLES) != 0) {
			return {};
		}
		ComPtr<IMFSample> sample;
		winrt::check_hresult(MFCreateSample(&sample));
		ComPtr<IMFMediaBuffer> buffer;
		winrt::check_hresult(MFCreateMemoryBuffer(outputStreamInfo_.cbSize, &buffer));
		winrt::check_hresult(sample->AddBuffer(buffer.Get()));
		return sample;
	}

	HRESULT ProcessOneOutput() {
		ComPtr<IMFSample> suppliedSample = CreateOutputSample();
		MFT_OUTPUT_DATA_BUFFER output{};
		output.dwStreamID = outputStreamId_;
		output.pSample = suppliedSample.Get();
		DWORD status = 0;
		const HRESULT processResult = transform_->ProcessOutput(0, 1, &output, &status);
		if (output.pEvents != nullptr) {
			output.pEvents->Release();
		}
		if (FAILED(processResult)) {
			if (!suppliedSample && output.pSample != nullptr) {
				output.pSample->Release();
			}
			return processResult;
		}

		ComPtr<IMFSample> encodedSample;
		if (suppliedSample) {
			encodedSample = suppliedSample;
		} else if (output.pSample != nullptr) {
			encodedSample.Attach(output.pSample);
		}
		if (!encodedSample) {
			throw std::runtime_error("Hardware encoder returned an empty output sample");
		}
		RecordOutput(encodedSample.Get());
		return S_OK;
	}

	void ProcessAvailableOutputs() {
		if (!asynchronous_) {
			return;
		}
		while (haveOutput_ > 0) {
			const HRESULT outputResult = ProcessOneOutput();
			if (outputResult == MF_E_TRANSFORM_NEED_MORE_INPUT) {
				haveOutput_ = 0;
				break;
			}
			winrt::check_hresult(outputResult);
			--haveOutput_;
		}
	}

	void ProcessSynchronousOutputs() {
		for (;;) {
			const HRESULT outputResult = ProcessOneOutput();
			if (outputResult == MF_E_TRANSFORM_NEED_MORE_INPUT) {
				break;
			}
			winrt::check_hresult(outputResult);
		}
	}

	void RecordOutput(IMFSample *sample) {
		ComPtr<IMFMediaBuffer> buffer;
		winrt::check_hresult(sample->ConvertToContiguousBuffer(&buffer));
		DWORD length = 0;
		winrt::check_hresult(buffer->GetCurrentLength(&length));
		if (length == 0) {
			throw std::runtime_error("Hardware encoder produced an empty H.264 sample");
		}
		result_.encodedBytes += length;
		result_.maxAccessUnitBytes =
			std::max(result_.maxAccessUnitBytes, static_cast<std::uint32_t>(length));
		BYTE *data = nullptr;
		DWORD maximumLength = 0;
		DWORD currentLength = 0;
		winrt::check_hresult(buffer->Lock(&data, &maximumLength, &currentLength));
		const bool annexB = ParseAnnexB(data, currentLength, result_);
		const bool avcc = !annexB && ParseAvcc(data, currentLength, result_);
		std::vector<std::uint8_t> encodedBytes;
		if (callback_) {
			encodedBytes.assign(data, data + currentLength);
		}
		buffer->Unlock();
		if (annexB) {
			result_.bitstreamFormat = "annex-b";
		} else if (avcc) {
			result_.bitstreamFormat = "avcc";
		}
		const std::uint64_t frameId = result_.encodedFrames;
		++result_.encodedFrames;
		UINT32 cleanPoint = FALSE;
		if (SUCCEEDED(sample->GetUINT32(MFSampleExtension_CleanPoint, &cleanPoint)) && cleanPoint != FALSE) {
			++result_.keyFrames;
		}

		LONGLONG sampleTime = 0;
		double encodeLatencyMs = 0.0;
		std::int64_t captureTimestampUs = 0;
		std::optional<std::uint32_t> submittedRtpTimestamp;
		if (SUCCEEDED(sample->GetSampleTime(&sampleTime))) {
			const auto submitted = submittedAt_.find(sampleTime);
			if (submitted != submittedAt_.end()) {
				encodeLatencyMs = Milliseconds(Clock::now() - submitted->second.capturedAt);
				latencies_.push_back(encodeLatencyMs);
				captureTimestampUs = std::chrono::duration_cast<std::chrono::microseconds>(
										 submitted->second.capturedAt.time_since_epoch())
										 .count();
				submittedRtpTimestamp = submitted->second.rtpTimestamp90Khz;
				submittedAt_.erase(submitted);
			}
		}
		if (callback_) {
			EncodedAccessUnit accessUnit{
				.bytes = std::move(encodedBytes),
				.frameId = frameId,
				.captureTimestampUs = captureTimestampUs,
				.presentationTimestampUs = sampleTime / 10,
				.rtpTimestamp90Khz = static_cast<std::uint32_t>(
					(static_cast<std::uint64_t>(sampleTime) * 9ULL) / 1000ULL),
				.width = width_,
				.height = height_,
				.keyFrame = cleanPoint != FALSE,
				.encodeLatencyMs = encodeLatencyMs,
			};
			if (annexB) {
				for (const H264Nalu &nalu : FindAnnexBNalus(accessUnit.bytes)) {
					accessUnit.containsSps = accessUnit.containsSps || nalu.type == 7;
					accessUnit.containsPps = accessUnit.containsPps || nalu.type == 8;
					accessUnit.containsIdr = accessUnit.containsIdr || nalu.type == 5;
				}
			}
			if (submittedRtpTimestamp.has_value()) {
				accessUnit.rtpTimestamp90Khz = *submittedRtpTimestamp;
			}
			callback_(std::move(accessUnit));
		}
	}

	const EncodeBenchmarkOptions &options_;
	EncodeBenchmarkResult &result_;
	EncodedAccessUnitCallback callback_;
	std::uint32_t width_ = 0;
	std::uint32_t height_ = 0;
	LONGLONG frameDuration_ = 0;
	ComPtr<IMFTransform> transform_;
	ComPtr<ICodecAPI> codec_;
	ComPtr<IMFMediaEventGenerator> eventGenerator_;
	ComPtr<IMFDXGIDeviceManager> deviceManager_;
	MFT_OUTPUT_STREAM_INFO outputStreamInfo_{};
	DWORD inputStreamId_ = 0;
	DWORD outputStreamId_ = 0;
	bool asynchronous_ = false;
	bool drainComplete_ = false;
	std::uint32_t needInput_ = 0;
	std::uint32_t haveOutput_ = 0;
	std::uint32_t submittedFrames_ = 0;
	bool dynamicBitrateAttempted_ = false;
	bool forceKeyFrameAttempted_ = false;
	struct SubmittedFrame {
		Clock::time_point capturedAt;
		std::optional<std::uint32_t> rtpTimestamp90Khz;
	};
	std::map<LONGLONG, SubmittedFrame> submittedAt_;

public:
	[[nodiscard]] const std::vector<double> &latencies() const noexcept {
		return latencies_;
	}

private:
	std::vector<double> latencies_;
};

GraphicsCaptureItem CreateCaptureItem(const std::string &sourceId) {
	auto interop = winrt::get_activation_factory<GraphicsCaptureItem, IGraphicsCaptureItemInterop>();
	GraphicsCaptureItem item{ nullptr };

	constexpr std::string_view monitorPrefix = "monitor:";
	constexpr std::string_view windowPrefix = "window:";
	if (sourceId.starts_with(monitorPrefix)) {
		MonitorSearch search{ .device = ToWide(std::string_view(sourceId).substr(monitorPrefix.size())) };
		EnumDisplayMonitors(nullptr, nullptr, FindMonitorCallback, reinterpret_cast<LPARAM>(&search));
		if (search.monitor == nullptr) {
			throw std::runtime_error("The selected monitor is no longer available");
		}
		winrt::check_hresult(
			interop->CreateForMonitor(search.monitor, winrt::guid_of<GraphicsCaptureItem>(), winrt::put_abi(item)));
		return item;
	}
	if (sourceId.starts_with(windowPrefix)) {
		const std::string handleText = sourceId.substr(windowPrefix.size());
		std::size_t parsed = 0;
		const std::uintptr_t rawHandle = std::stoull(handleText, &parsed, 0);
		if (parsed != handleText.size()) {
			throw std::runtime_error("The window source id is invalid");
		}
		const HWND window = reinterpret_cast<HWND>(rawHandle);
		if (!IsWindow(window)) {
			throw std::runtime_error("The selected window is no longer available");
		}
		winrt::check_hresult(
			interop->CreateForWindow(window, winrt::guid_of<GraphicsCaptureItem>(), winrt::put_abi(item)));
		return item;
	}
	throw std::runtime_error("Unsupported capture source id");
}

void CalculateTiming(const std::vector<Clock::time_point> &timestamps, CaptureBenchmarkResult &result) {
	if (timestamps.empty()) {
		return;
	}
	if (timestamps.size() == 1) {
		return;
	}

	std::vector<double> intervals;
	intervals.reserve(timestamps.size() - 1);
	for (std::size_t index = 1; index < timestamps.size(); ++index) {
		intervals.push_back(Milliseconds(timestamps[index] - timestamps[index - 1]));
	}
	result.measurementDurationMs = Milliseconds(timestamps.back() - timestamps.front());
	if (result.measurementDurationMs > 0.0) {
		result.averageFps =
			static_cast<double>(timestamps.size() - 1) * 1000.0 / result.measurementDurationMs;
	}
	result.averageFrameIntervalMs =
		std::accumulate(intervals.begin(), intervals.end(), 0.0) / static_cast<double>(intervals.size());
	result.maxFrameIntervalMs = *std::max_element(intervals.begin(), intervals.end());

	std::vector<double> sortedIntervals = intervals;
	std::sort(sortedIntervals.begin(), sortedIntervals.end());
	const std::size_t p95Index =
		std::min(sortedIntervals.size() - 1,
				 static_cast<std::size_t>(std::ceil(static_cast<double>(sortedIntervals.size()) * 0.95)) - 1);
	result.p95FrameIntervalMs = sortedIntervals[p95Index];

	const double median = sortedIntervals[sortedIntervals.size() / 2];
	if (median > 0.0) {
		for (const double interval : intervals) {
			if (interval > median * 1.5) {
				const auto spannedFrames = static_cast<std::uint32_t>(std::llround(interval / median));
				if (spannedFrames > 1) {
					result.estimatedDroppedFrames += spannedFrames - 1;
				}
			}
		}
	}
}

void CalculateEncodeTiming(const std::vector<double> &latencies, EncodeBenchmarkResult &result) {
	if (latencies.empty()) {
		return;
	}
	result.averageEncodeLatencyMs =
		std::accumulate(latencies.begin(), latencies.end(), 0.0) / static_cast<double>(latencies.size());
	result.maxEncodeLatencyMs = *std::max_element(latencies.begin(), latencies.end());
	std::vector<double> sorted = latencies;
	std::sort(sorted.begin(), sorted.end());
	const std::size_t p95Index =
		std::min(sorted.size() - 1,
				 static_cast<std::size_t>(std::ceil(static_cast<double>(sorted.size()) * 0.95)) - 1);
	result.p95EncodeLatencyMs = sorted[p95Index];
}

} // namespace

struct CaptureSession::Impl {
	struct State {
		ComPtr<ID3D11Device> nativeDevice;
		IDirect3DDevice captureDevice{ nullptr };
		CapturedTextureCallback onFrame;
		CaptureErrorCallback onError;
		std::atomic<std::uint32_t> width{ 0 };
		std::atomic<std::uint32_t> height{ 0 };
		std::atomic<bool> running{ false };
		std::atomic<bool> stopping{ false };
	};

	Impl(CaptureSessionConfig config,
		 CapturedTextureCallback onFrame,
		 CaptureErrorCallback onError)
		: state(std::make_shared<State>()) {
		if (config.sourceId.empty()) {
			throw std::invalid_argument("Capture session requires a source id");
		}
		if (!onFrame) {
			throw std::invalid_argument("Capture session requires a frame callback");
		}
		if (!com.available()) {
			throw std::runtime_error("COM initialization failed");
		}

		state->onFrame = std::move(onFrame);
		state->onError = std::move(onError);
		state->captureDevice = CreateCaptureDevice(state->nativeDevice);
		item = CreateCaptureItem(config.sourceId);
		const auto initialSize = item.Size();
		if (initialSize.Width <= 0 || initialSize.Height <= 0) {
			throw std::runtime_error("The capture source has an invalid size");
		}
		state->width = static_cast<std::uint32_t>(initialSize.Width);
		state->height = static_cast<std::uint32_t>(initialSize.Height);
		framePool = Direct3D11CaptureFramePool::CreateFreeThreaded(
			state->captureDevice,
			DirectXPixelFormat::B8G8R8A8UIntNormalized,
			3,
			initialSize);
		session = framePool.CreateCaptureSession(item);
		try {
			session.IsCursorCaptureEnabled(config.captureCursor);
		} catch (...) {
		}

		const std::shared_ptr<State> callbackState = state;
		frameToken = framePool.FrameArrived(
			[callbackState](
				const Direct3D11CaptureFramePool &sender,
				const winrt::Windows::Foundation::IInspectable &) {
				if (callbackState->stopping.load(std::memory_order_acquire)) {
					return;
				}
				try {
					const auto frame = sender.TryGetNextFrame();
					if (!frame) {
						return;
					}
					const auto contentSize = frame.ContentSize();
					if (contentSize.Width <= 0 || contentSize.Height <= 0) {
						return;
					}
					const auto surfaceAccess = frame.Surface().as<
						Windows::Graphics::DirectX::Direct3D11::IDirect3DDxgiInterfaceAccess>();
					ComPtr<ID3D11Texture2D> texture;
					winrt::check_hresult(surfaceAccess->GetInterface(IID_PPV_ARGS(&texture)));

					D3D11_TEXTURE2D_DESC description{};
					texture->GetDesc(&description);
					callbackState->width.store(description.Width, std::memory_order_release);
					callbackState->height.store(description.Height, std::memory_order_release);
					callbackState->onFrame(CapturedTextureFrame{
						.texture = texture.Get(),
						.width = description.Width,
						.height = description.Height,
						.capturedAt = Clock::now(),
					});

					if (contentSize.Width != static_cast<INT32>(description.Width) ||
						contentSize.Height != static_cast<INT32>(description.Height)) {
						sender.Recreate(
							callbackState->captureDevice,
							DirectXPixelFormat::B8G8R8A8UIntNormalized,
							3,
							contentSize);
					}
				} catch (const winrt::hresult_error &error) {
					if (callbackState->onError &&
						!callbackState->stopping.load(std::memory_order_acquire)) {
						callbackState->onError(
							"Windows Graphics Capture failed: " + FormatHresult(error.code()));
					}
				} catch (const std::exception &error) {
					if (callbackState->onError &&
						!callbackState->stopping.load(std::memory_order_acquire)) {
						callbackState->onError(error.what());
					}
				} catch (...) {
					if (callbackState->onError &&
						!callbackState->stopping.load(std::memory_order_acquire)) {
						callbackState->onError("Unknown Windows Graphics Capture failure");
					}
				}
			});
		subscribed = true;
	}

	~Impl() {
		Stop();
	}

	void Start() {
		if (closed) {
			throw std::logic_error("Capture session cannot restart after it has stopped");
		}
		if (state->running.exchange(true, std::memory_order_acq_rel)) {
			return;
		}
		state->stopping.store(false, std::memory_order_release);
		session.StartCapture();
	}

	void Stop() noexcept {
		if (closed) {
			return;
		}
		closed = true;
		state->stopping.store(true, std::memory_order_release);
		state->running.store(false, std::memory_order_release);
		try {
			if (subscribed) {
				framePool.FrameArrived(frameToken);
				subscribed = false;
			}
			if (session) {
				session.Close();
			}
			if (framePool) {
				framePool.Close();
			}
		} catch (...) {
		}
	}

	ComSession com;
	std::shared_ptr<State> state;
	GraphicsCaptureItem item{ nullptr };
	Direct3D11CaptureFramePool framePool{ nullptr };
	GraphicsCaptureSession session{ nullptr };
	winrt::event_token frameToken{};
	bool subscribed = false;
	bool closed = false;
};

CaptureSession::CaptureSession(
	CaptureSessionConfig config,
	CapturedTextureCallback onFrame,
	CaptureErrorCallback onError)
	: impl_(std::make_unique<Impl>(
		  std::move(config), std::move(onFrame), std::move(onError))) {}

CaptureSession::~CaptureSession() = default;

void CaptureSession::Start() {
	impl_->Start();
}

void CaptureSession::Stop() noexcept {
	impl_->Stop();
}

bool CaptureSession::running() const noexcept {
	return impl_->state->running.load(std::memory_order_acquire);
}

ID3D11Device *CaptureSession::device() const noexcept {
	return impl_->state->nativeDevice.Get();
}

std::string CaptureSession::adapterName() const {
	return AdapterName(impl_->state->nativeDevice.Get());
}

std::uint32_t CaptureSession::width() const noexcept {
	return impl_->state->width.load(std::memory_order_acquire);
}

std::uint32_t CaptureSession::height() const noexcept {
	return impl_->state->height.load(std::memory_order_acquire);
}

struct HardwareEncoderSession::Impl {
	Impl(ID3D11Device *device,
		 HardwareEncoderConfig config,
		 EncodedAccessUnitCallback callback)
		: options{
			  .sourceId = "live",
			  .targetFrames = 0xFFFFFFFFU,
			  .frameRate = config.frameRate,
			  .bitrate = config.bitrate,
			  .keyFrameInterval = config.keyFrameInterval,
			  .width = config.width,
			  .height = config.height,
			  .profile = config.profile,
			  .contentMode = config.contentMode,
			  .onEncodedAccessUnit = std::move(callback),
		  } {
		if (device == nullptr) {
			throw std::invalid_argument("Hardware encoder requires a D3D11 device");
		}
		if (!com.available() || !mediaFoundation.available()) {
			throw std::runtime_error("COM or Media Foundation initialization failed");
		}
		if (config.width < 320 || config.width > 7680 || config.height < 180 ||
			config.height > 4320) {
			throw std::invalid_argument("Hardware encoder dimensions are outside the supported range");
		}
		if (config.frameRate < 15 || config.frameRate > 240) {
			throw std::invalid_argument("Hardware encoder frame rate must be between 15 and 240");
		}
		if (config.bitrate < 500'000 || config.bitrate > 100'000'000) {
			throw std::invalid_argument("Hardware encoder bitrate must be between 500000 and 100000000");
		}
		if (config.keyFrameInterval == 0) {
			throw std::invalid_argument("Hardware encoder key frame interval must be greater than zero");
		}

		stats.sourceId = "live";
		stats.adapterName =
			config.adapterName.empty() ? AdapterName(device) : std::move(config.adapterName);
		stats.width = config.width;
		stats.height = config.height;
		stats.configuredFrameRate = config.frameRate;
		stats.configuredBitrate = config.bitrate;
		stats.contentMode =
			config.contentMode == ScreenContentMode::Detail ? "detail" : "motion";
		encoder = std::make_unique<HardwareH264Encoder>(
			device, stats.adapterName, options, config.width, config.height, stats);
	}

	ComSession com;
	MediaFoundationSession mediaFoundation;
	EncodeBenchmarkOptions options;
	EncodeBenchmarkResult stats;
	std::unique_ptr<HardwareH264Encoder> encoder;
};

HardwareEncoderSession::HardwareEncoderSession(
	ID3D11Device *device,
	HardwareEncoderConfig config,
	EncodedAccessUnitCallback callback)
	: impl_(std::make_unique<Impl>(device, std::move(config), std::move(callback))) {}

HardwareEncoderSession::~HardwareEncoderSession() = default;
HardwareEncoderSession::HardwareEncoderSession(HardwareEncoderSession &&) noexcept = default;
HardwareEncoderSession &
HardwareEncoderSession::operator=(HardwareEncoderSession &&) noexcept = default;

void HardwareEncoderSession::Encode(
	ID3D11Texture2D *texture,
	const std::chrono::steady_clock::time_point capturedAt) {
	if (!impl_) {
		throw std::logic_error("Hardware encoder session has been moved");
	}
	impl_->encoder->Encode(texture, capturedAt);
}

void HardwareEncoderSession::Encode(
	ID3D11Texture2D *texture,
	const std::chrono::steady_clock::time_point capturedAt,
	const std::uint32_t rtpTimestamp90Khz) {
	if (!impl_) {
		throw std::logic_error("Hardware encoder session has been moved");
	}
	impl_->encoder->Encode(texture, capturedAt, rtpTimestamp90Khz);
}

void HardwareEncoderSession::Pump() {
	if (!impl_) {
		throw std::logic_error("Hardware encoder session has been moved");
	}
	impl_->encoder->Pump();
}

void HardwareEncoderSession::Finish() {
	if (!impl_) {
		throw std::logic_error("Hardware encoder session has been moved");
	}
	impl_->encoder->Finish();
}

bool HardwareEncoderSession::SetTargetBitrate(const std::uint32_t bitrate) {
	if (!impl_) {
		throw std::logic_error("Hardware encoder session has been moved");
	}
	if (bitrate < 500'000 || bitrate > 100'000'000) {
		return false;
	}
	return impl_->encoder->SetTargetBitrate(bitrate);
}

bool HardwareEncoderSession::RequestKeyFrame() {
	if (!impl_) {
		throw std::logic_error("Hardware encoder session has been moved");
	}
	return impl_->encoder->RequestKeyFrame();
}

const EncodeBenchmarkResult &HardwareEncoderSession::stats() const noexcept {
	static const EncodeBenchmarkResult empty;
	return impl_ ? impl_->stats : empty;
}

CaptureBenchmarkResult RunCaptureBenchmark(const CaptureBenchmarkOptions &options) {
	CaptureBenchmarkResult result;
	result.sourceId = options.sourceId;
	result.requestedFrames = options.targetFrames;

	if (options.sourceId.empty()) {
		result.error = "A capture source id is required";
		return result;
	}
	if (options.targetFrames < 2 || options.targetFrames > 3600) {
		result.error = "targetFrames must be between 2 and 3600";
		return result;
	}
	if (options.timeoutMs < 500 || options.timeoutMs > 60000) {
		result.error = "timeoutMs must be between 500 and 60000";
		return result;
	}

	try {
		std::mutex mutex;
		std::condition_variable condition;
		std::vector<Clock::time_point> timestamps;
		timestamps.reserve(options.targetFrames);
		std::string callbackError;
		bool complete = false;
		const Clock::time_point started = Clock::now();

		CaptureSession session(
			CaptureSessionConfig{
				.sourceId = options.sourceId,
				.captureCursor = options.captureCursor,
			},
			[&](const CapturedTextureFrame &frame) {
				D3D11_TEXTURE2D_DESC description{};
				frame.texture->GetDesc(&description);
				const Clock::time_point timestamp = frame.capturedAt;
				{
					std::lock_guard lock(mutex);
					if (complete) {
						return;
					}
					if (timestamps.empty()) {
						result.firstFrameLatencyMs = Milliseconds(timestamp - started);
						result.width = description.Width;
						result.height = description.Height;
						result.textureFormat = DxgiFormatName(description.Format);
					}
					timestamps.push_back(timestamp);
					if (timestamps.size() >= options.targetFrames) {
						complete = true;
						condition.notify_one();
					}
				}
			},
			[&](const std::string &error) {
				std::lock_guard lock(mutex);
				callbackError = error;
				complete = true;
				condition.notify_one();
			});
		result.adapterName = session.adapterName();

		session.Start();
		{
			std::unique_lock lock(mutex);
			if (!condition.wait_for(
					lock, std::chrono::milliseconds(options.timeoutMs), [&] { return complete; })) {
				complete = true;
				callbackError = "Capture timed out before the requested frame count";
			}
		}

		session.Stop();

		result.capturedFrames = static_cast<std::uint32_t>(timestamps.size());
		CalculateTiming(timestamps, result);
		if (!callbackError.empty()) {
			result.error = callbackError;
			return result;
		}
		result.success = result.capturedFrames >= options.targetFrames;
		if (!result.success) {
			result.error = "Capture ended before the requested frame count";
		}
	} catch (const winrt::hresult_error &error) {
		result.error = "Windows capture failed: " + FormatHresult(error.code());
	} catch (const std::exception &error) {
		result.error = error.what();
	} catch (...) {
		result.error = "Unknown capture failure";
	}
	return result;
}

std::string SerializeCaptureBenchmark(const CaptureBenchmarkResult &result) {
	std::ostringstream json;
	json << std::fixed << std::setprecision(3);
	json << "{\"schema\":" << Quote(result.schema) << ",\"coreVersion\":" << Quote(result.coreVersion)
		 << ",\"sourceId\":" << Quote(result.sourceId) << ",\"success\":" << Bool(result.success)
		 << ",\"error\":" << Quote(result.error) << ",\"adapterName\":" << Quote(result.adapterName)
		 << ",\"textureFormat\":" << Quote(result.textureFormat) << ",\"width\":" << result.width
		 << ",\"height\":" << result.height << ",\"requestedFrames\":" << result.requestedFrames
		 << ",\"capturedFrames\":" << result.capturedFrames << ",\"estimatedDroppedFrames\":"
		 << result.estimatedDroppedFrames << ",\"firstFrameLatencyMs\":" << result.firstFrameLatencyMs
		 << ",\"measurementDurationMs\":" << result.measurementDurationMs << ",\"averageFps\":"
		 << result.averageFps << ",\"averageFrameIntervalMs\":" << result.averageFrameIntervalMs
		 << ",\"p95FrameIntervalMs\":" << result.p95FrameIntervalMs << ",\"maxFrameIntervalMs\":"
		 << result.maxFrameIntervalMs << "}";
	return json.str();
}

EncodeBenchmarkResult RunSyntheticEncodeBenchmark(const EncodeBenchmarkOptions &options) {
	EncodeBenchmarkResult result;
	result.sourceId = options.sourceId;
	result.width = options.width;
	result.height = options.height;
	result.configuredFrameRate = options.frameRate;
	result.configuredBitrate = options.bitrate;
	result.contentMode =
		options.contentMode == ScreenContentMode::Detail ? "detail" : "motion";

	try {
		const ComSession com;
		const MediaFoundationSession mediaFoundation;
		if (!com.available() || !mediaFoundation.available()) {
			result.error = "COM or Media Foundation initialization failed";
			return result;
		}

		ComPtr<ID3D11Device> nativeDevice;
		CreateCaptureDevice(nativeDevice);
		result.adapterName = AdapterName(nativeDevice.Get());
		ComPtr<ID3D11DeviceContext> context;
		nativeDevice->GetImmediateContext(&context);
		ComPtr<ID3D11DeviceContext1> context1;
		winrt::check_hresult(context.As(&context1));

		struct RenderTarget {
			ComPtr<ID3D11Texture2D> texture;
			ComPtr<ID3D11RenderTargetView> view;
		};
		std::array<RenderTarget, 3> targets;
		const D3D11_TEXTURE2D_DESC textureDescription{
			.Width = options.width,
			.Height = options.height,
			.MipLevels = 1,
			.ArraySize = 1,
			.Format = DXGI_FORMAT_B8G8R8A8_UNORM,
			.SampleDesc = DXGI_SAMPLE_DESC{ .Count = 1, .Quality = 0 },
			.Usage = D3D11_USAGE_DEFAULT,
			.BindFlags = D3D11_BIND_RENDER_TARGET | D3D11_BIND_SHADER_RESOURCE,
			.CPUAccessFlags = 0,
			.MiscFlags = 0,
		};
		for (auto &target : targets) {
			winrt::check_hresult(
				nativeDevice->CreateTexture2D(&textureDescription, nullptr, &target.texture));
			winrt::check_hresult(
				nativeDevice->CreateRenderTargetView(target.texture.Get(), nullptr, &target.view));
		}

		HardwareH264Encoder encoder(
			nativeDevice.Get(), result.adapterName, options, options.width, options.height, result);
		const auto frameInterval = std::chrono::duration_cast<Clock::duration>(
			std::chrono::duration<double>(1.0 / static_cast<double>(options.frameRate)));
		const Clock::time_point started = Clock::now();
		Clock::time_point nextFrameAt = started;
		Clock::time_point firstEncodedAt{};
		Clock::time_point lastEncodedAt{};

		for (std::uint32_t frameIndex = 0; frameIndex < options.targetFrames; ++frameIndex) {
			while (Clock::now() < nextFrameAt) {
				encoder.Pump();
				Sleep(1);
			}
			RenderTarget &target = targets[frameIndex % targets.size()];
			const float background[] = {
				static_cast<float>((frameIndex * 17U) % 255U) / 765.0F,
				static_cast<float>((frameIndex * 29U) % 255U) / 765.0F,
				static_cast<float>((frameIndex * 43U) % 255U) / 765.0F,
				1.0F,
			};
			context->ClearRenderTargetView(target.view.Get(), background);

			for (std::uint32_t block = 0; block < 160; ++block) {
				const LONG blockWidth = static_cast<LONG>(48U + (block * 13U) % 176U);
				const LONG blockHeight = static_cast<LONG>(32U + (block * 19U) % 128U);
				const LONG maxX = std::max<LONG>(1, static_cast<LONG>(options.width) - blockWidth);
				const LONG maxY = std::max<LONG>(1, static_cast<LONG>(options.height) - blockHeight);
				const LONG x =
					static_cast<LONG>((block * 197U + frameIndex * (11U + block % 17U)) %
									  static_cast<std::uint32_t>(maxX));
				const LONG y =
					static_cast<LONG>((block * 113U + frameIndex * (7U + block % 13U)) %
									  static_cast<std::uint32_t>(maxY));
				const D3D11_RECT rectangle{
					.left = x,
					.top = y,
					.right = std::min(static_cast<LONG>(options.width), x + blockWidth),
					.bottom = std::min(static_cast<LONG>(options.height), y + blockHeight),
				};
				const float color[] = {
					static_cast<float>((block * 37U + frameIndex * 3U) % 255U) / 255.0F,
					static_cast<float>((block * 71U + frameIndex * 5U) % 255U) / 255.0F,
					static_cast<float>((block * 109U + frameIndex * 7U) % 255U) / 255.0F,
					1.0F,
				};
				context1->ClearView(target.view.Get(), color, &rectangle, 1);
			}
			context->Flush();

			const Clock::time_point capturedAt = Clock::now();
			if (firstEncodedAt == Clock::time_point{}) {
				firstEncodedAt = capturedAt;
				result.firstFrameLatencyMs = Milliseconds(capturedAt - started);
			}
			++result.capturedFrames;
			encoder.Encode(target.texture.Get(), capturedAt);
			lastEncodedAt = Clock::now();
			nextFrameAt += frameInterval;
		}
		encoder.Finish();

		if (lastEncodedAt > firstEncodedAt) {
			result.measurementDurationMs = Milliseconds(lastEncodedAt - firstEncodedAt);
		}
		if (result.measurementDurationMs > 0.0) {
			result.encodeThroughputFps =
				static_cast<double>(result.submittedFrames - 1) * 1000.0 / result.measurementDurationMs;
			result.actualBitrateMbps =
				static_cast<double>(result.encodedBytes) * 8.0 / result.measurementDurationMs / 1000.0;
		}
		CalculateEncodeTiming(encoder.latencies(), result);
		result.success = result.submittedFrames >= options.targetFrames &&
						 result.encodedFrames >= result.submittedFrames &&
						 result.gpuSurfaceInput && result.bitstreamFormat != "unknown" &&
						 result.spsUnits > 0 && result.ppsUnits > 0 && result.idrUnits > 0;
		if (!result.success) {
			result.error = "Synthetic hardware encoder benchmark did not produce a complete H.264 stream";
		}
	} catch (const winrt::hresult_error &error) {
		result.error = "Synthetic hardware encode failed: " + FormatHresult(error.code());
	} catch (const std::exception &error) {
		result.error = error.what();
	} catch (...) {
		result.error = "Unknown synthetic hardware encode failure";
	}
	return result;
}

EncodeBenchmarkResult RunEncodeBenchmark(const EncodeBenchmarkOptions &options) {
	EncodeBenchmarkResult result;
	result.sourceId = options.sourceId;
	result.configuredFrameRate = options.frameRate;
	result.configuredBitrate = options.bitrate;
	result.contentMode =
		options.contentMode == ScreenContentMode::Detail ? "detail" : "motion";

	if (options.sourceId.empty()) {
		result.error = "A capture source id is required";
		return result;
	}
	if (options.targetFrames < 2 || options.targetFrames > 3600) {
		result.error = "targetFrames must be between 2 and 3600";
		return result;
	}
	if (options.frameRate < 15 || options.frameRate > 240) {
		result.error = "frameRate must be between 15 and 240";
		return result;
	}
	if (options.bitrate < 500'000 || options.bitrate > 100'000'000) {
		result.error = "bitrate must be between 500000 and 100000000";
		return result;
	}
	if (options.width < 320 || options.width > 7680 || options.height < 180 || options.height > 4320) {
		result.error = "Synthetic dimensions are outside the supported range";
		return result;
	}
	if (options.sourceId == "synthetic:motion") {
		return RunSyntheticEncodeBenchmark(options);
	}

	try {
		const ComSession com;
		const MediaFoundationSession mediaFoundation;
		if (!com.available() || !mediaFoundation.available()) {
			result.error = "COM or Media Foundation initialization failed";
			return result;
		}

		ComPtr<ID3D11Device> nativeDevice;
		const IDirect3DDevice captureDevice = CreateCaptureDevice(nativeDevice);
		result.adapterName = AdapterName(nativeDevice.Get());
		const GraphicsCaptureItem item = CreateCaptureItem(options.sourceId);
		const auto size = item.Size();
		if (size.Width <= 0 || size.Height <= 0) {
			result.error = "The capture source has an invalid size";
			return result;
		}
		result.width = static_cast<std::uint32_t>(size.Width);
		result.height = static_cast<std::uint32_t>(size.Height);

		HardwareH264Encoder encoder(
			nativeDevice.Get(), result.adapterName, options, result.width, result.height, result);
		Direct3D11CaptureFramePool framePool = Direct3D11CaptureFramePool::CreateFreeThreaded(
			captureDevice, DirectXPixelFormat::B8G8R8A8UIntNormalized, 3, size);
		GraphicsCaptureSession session = framePool.CreateCaptureSession(item);
		try {
			session.IsCursorCaptureEnabled(options.captureCursor);
		} catch (...) {
		}

		std::mutex mutex;
		std::condition_variable condition;
		std::condition_variable frameAvailable;
		std::string callbackError;
		bool complete = false;
		bool stopWorker = false;
		const Clock::time_point started = Clock::now();
		Clock::time_point encodeStartedAt{};
		Clock::time_point encodeCompletedAt{};
		struct PendingFrame {
			ComPtr<ID3D11Texture2D> texture;
			Clock::time_point capturedAt;
		};
		std::optional<PendingFrame> latestFrame;

		std::thread encoderThread([&] {
			try {
				const auto frameInterval =
					std::chrono::duration_cast<Clock::duration>(
						std::chrono::duration<double>(1.0 / static_cast<double>(options.frameRate)));
				Clock::time_point nextFrameAt{};
				for (;;) {
					PendingFrame pending;
					{
						std::unique_lock lock(mutex);
						frameAvailable.wait_for(
							lock,
							std::chrono::milliseconds(1),
							[&] { return stopWorker || latestFrame.has_value(); });
						if (stopWorker && !latestFrame.has_value()) {
							break;
						}
						if (!latestFrame.has_value()) {
							lock.unlock();
							encoder.Pump();
							continue;
						}
						if (nextFrameAt != Clock::time_point{} &&
							latestFrame->capturedAt < nextFrameAt) {
							latestFrame.reset();
							++result.discardedCaptureFrames;
							continue;
						}
						pending = std::move(*latestFrame);
						latestFrame.reset();
					}

					if (encodeStartedAt == Clock::time_point{}) {
						encodeStartedAt = Clock::now();
					}
					encoder.Encode(pending.texture.Get(), pending.capturedAt);
					const Clock::time_point encodedAt = Clock::now();
					encodeCompletedAt = encodedAt;
					if (nextFrameAt == Clock::time_point{}) {
						nextFrameAt = pending.capturedAt + frameInterval;
					} else {
						nextFrameAt += frameInterval;
						if (nextFrameAt < pending.capturedAt) {
							nextFrameAt = pending.capturedAt + frameInterval;
						}
					}

					std::lock_guard lock(mutex);
					if (result.submittedFrames >= options.targetFrames) {
						stopWorker = true;
						complete = true;
						latestFrame.reset();
						condition.notify_one();
						break;
					}
				}
			} catch (const winrt::hresult_error &error) {
				std::lock_guard lock(mutex);
				callbackError = "Hardware encode failed: " + FormatHresult(error.code());
				stopWorker = true;
				complete = true;
				latestFrame.reset();
				condition.notify_one();
			} catch (const std::exception &error) {
				std::lock_guard lock(mutex);
				callbackError = error.what();
				stopWorker = true;
				complete = true;
				latestFrame.reset();
				condition.notify_one();
			}
		});

		const winrt::event_token frameToken = framePool.FrameArrived(
			[&](const Direct3D11CaptureFramePool &sender, const winrt::Windows::Foundation::IInspectable &) {
				try {
					const auto frame = sender.TryGetNextFrame();
					if (!frame) {
						return;
					}
					const auto surfaceAccess = frame.Surface().as<
						Windows::Graphics::DirectX::Direct3D11::IDirect3DDxgiInterfaceAccess>();
					ComPtr<ID3D11Texture2D> texture;
					winrt::check_hresult(surfaceAccess->GetInterface(IID_PPV_ARGS(&texture)));
					const Clock::time_point capturedAt = Clock::now();

					{
						std::lock_guard lock(mutex);
						if (complete) {
							return;
						}
						if (result.capturedFrames == 0) {
							result.firstFrameLatencyMs = Milliseconds(capturedAt - started);
						}
						++result.capturedFrames;
						if (latestFrame.has_value()) {
							++result.discardedCaptureFrames;
						}
						latestFrame = PendingFrame{ .texture = texture, .capturedAt = capturedAt };
					}
					frameAvailable.notify_one();
				} catch (const winrt::hresult_error &error) {
					std::lock_guard lock(mutex);
					callbackError = "Capture or encode failed: " + FormatHresult(error.code());
					stopWorker = true;
					complete = true;
					condition.notify_one();
					frameAvailable.notify_one();
				} catch (const std::exception &error) {
					std::lock_guard lock(mutex);
					callbackError = error.what();
					stopWorker = true;
					complete = true;
					condition.notify_one();
					frameAvailable.notify_one();
				}
			});

		session.StartCapture();
		{
			std::unique_lock lock(mutex);
			if (!condition.wait_for(
					lock, std::chrono::milliseconds(options.timeoutMs), [&] { return complete; })) {
				complete = true;
				stopWorker = true;
				latestFrame.reset();
				callbackError = "Encode benchmark timed out";
				frameAvailable.notify_one();
			}
		}
		framePool.FrameArrived(frameToken);
		session.Close();
		framePool.Close();
		{
			std::lock_guard lock(mutex);
			stopWorker = true;
			latestFrame.reset();
		}
		frameAvailable.notify_one();
		encoderThread.join();

		if (callbackError.empty()) {
			encoder.Finish();
		}
		if (encodeStartedAt != Clock::time_point{} && encodeCompletedAt > encodeStartedAt) {
			result.measurementDurationMs = Milliseconds(encodeCompletedAt - encodeStartedAt);
		}
		if (result.measurementDurationMs > 0.0) {
			result.encodeThroughputFps =
				static_cast<double>(result.submittedFrames - 1) * 1000.0 / result.measurementDurationMs;
			result.actualBitrateMbps =
				static_cast<double>(result.encodedBytes) * 8.0 / result.measurementDurationMs / 1000.0;
		}
		CalculateEncodeTiming(encoder.latencies(), result);

		if (!callbackError.empty()) {
			result.error = callbackError;
			return result;
		}
		result.success = result.submittedFrames >= options.targetFrames &&
						 result.encodedFrames >= result.submittedFrames &&
						 result.encodedBytes > 0 && result.gpuSurfaceInput &&
						 result.bitstreamFormat != "unknown" && result.spsUnits > 0 &&
						 result.ppsUnits > 0 && result.idrUnits > 0;
		if (!result.success) {
			result.error = "Hardware encoder did not produce all requested frames";
		}
	} catch (const winrt::hresult_error &error) {
		result.error = "Windows hardware encode failed: " + FormatHresult(error.code());
	} catch (const std::exception &error) {
		result.error = error.what();
	} catch (...) {
		result.error = "Unknown hardware encode failure";
	}
	return result;
}

std::string SerializeEncodeBenchmark(const EncodeBenchmarkResult &result) {
	std::ostringstream json;
	json << std::fixed << std::setprecision(3);
	json << "{\"schema\":" << Quote(result.schema) << ",\"coreVersion\":" << Quote(result.coreVersion)
		 << ",\"sourceId\":" << Quote(result.sourceId) << ",\"success\":" << Bool(result.success)
		 << ",\"error\":" << Quote(result.error) << ",\"adapterName\":" << Quote(result.adapterName)
		 << ",\"encoderName\":" << Quote(result.encoderName) << ",\"inputFormat\":"
		 << Quote(result.inputFormat) << ",\"outputFormat\":" << Quote(result.outputFormat)
		 << ",\"asynchronous\":" << Bool(result.asynchronous) << ",\"d3d11Aware\":"
		 << Bool(result.d3d11Aware) << ",\"gpuSurfaceInput\":" << Bool(result.gpuSurfaceInput)
		 << ",\"lowLatencyEnabled\":" << Bool(result.lowLatencyEnabled)
		 << ",\"forceKeyFrameSupported\":" << Bool(result.forceKeyFrameSupported)
		 << ",\"dynamicBitrateSupported\":" << Bool(result.dynamicBitrateSupported)
		 << ",\"bitstreamFormat\":" << Quote(result.bitstreamFormat)
		 << ",\"contentMode\":" << Quote(result.contentMode)
		 << ",\"spsProfileIdc\":" << result.spsProfileIdc
		 << ",\"spsConstraintFlags\":" << result.spsConstraintFlags
		 << ",\"spsLevelIdc\":" << result.spsLevelIdc << ",\"width\":" << result.width
		 << ",\"height\":" << result.height << ",\"configuredFrameRate\":" << result.configuredFrameRate
		 << ",\"configuredBitrate\":" << result.configuredBitrate << ",\"capturedFrames\":"
		 << result.capturedFrames << ",\"discardedCaptureFrames\":" << result.discardedCaptureFrames
		 << ",\"submittedFrames\":" << result.submittedFrames
		 << ",\"encodedFrames\":" << result.encodedFrames << ",\"keyFrames\":" << result.keyFrames
		 << ",\"spsUnits\":" << result.spsUnits << ",\"ppsUnits\":" << result.ppsUnits
		 << ",\"idrUnits\":" << result.idrUnits << ",\"maxAccessUnitBytes\":"
		 << result.maxAccessUnitBytes << ",\"encodedBytes\":" << result.encodedBytes
		 << ",\"firstFrameLatencyMs\":"
		 << result.firstFrameLatencyMs << ",\"measurementDurationMs\":" << result.measurementDurationMs
		 << ",\"encodeThroughputFps\":" << result.encodeThroughputFps << ",\"actualBitrateMbps\":"
		 << result.actualBitrateMbps << ",\"averageEncodeLatencyMs\":" << result.averageEncodeLatencyMs
		 << ",\"p95EncodeLatencyMs\":" << result.p95EncodeLatencyMs << ",\"maxEncodeLatencyMs\":"
		 << result.maxEncodeLatencyMs << "}";
	return json.str();
}

} // namespace poio::share
