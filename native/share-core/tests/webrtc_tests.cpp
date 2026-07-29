#include "poio/share/webrtc.hpp"

#include <d3d11.h>
#include <wrl/client.h>

#include <exception>
#include <chrono>
#include <iostream>
#include <iterator>
#include <string>

namespace {

int failures = 0;

void Expect(const bool condition, const std::string &message) {
	if (!condition) {
		std::cerr << "FAILED: " << message << '\n';
		++failures;
	}
}

class FrameSink final
	: public webrtc::VideoSinkInterface<webrtc::VideoFrame> {
public:
	void OnFrame(const webrtc::VideoFrame &frame) override {
		width = frame.width();
		height = frame.height();
		++frames;
	}

	int width = 0;
	int height = 0;
	int frames = 0;
};

} // namespace

int main() {
	Microsoft::WRL::ComPtr<ID3D11Device> device;
	Microsoft::WRL::ComPtr<ID3D11DeviceContext> context;
	D3D_FEATURE_LEVEL selectedFeatureLevel{};
	const D3D_FEATURE_LEVEL featureLevels[]{
		D3D_FEATURE_LEVEL_12_1,
		D3D_FEATURE_LEVEL_12_0,
		D3D_FEATURE_LEVEL_11_1,
		D3D_FEATURE_LEVEL_11_0,
	};
	const HRESULT deviceResult = D3D11CreateDevice(
		nullptr,
		D3D_DRIVER_TYPE_HARDWARE,
		nullptr,
		D3D11_CREATE_DEVICE_BGRA_SUPPORT | D3D11_CREATE_DEVICE_VIDEO_SUPPORT,
		featureLevels,
		static_cast<UINT>(std::size(featureLevels)),
		D3D11_SDK_VERSION,
		&device,
		&selectedFeatureLevel,
		&context);
	Expect(SUCCEEDED(deviceResult) && device != nullptr, "D3D11 hardware device is created");
	if (!device) {
		return 1;
	}

	auto encoderFactory =
		poio::share::CreateMfH264EncoderFactory(device.Get(), "test-adapter");
	Expect(encoderFactory != nullptr, "Media Foundation encoder factory is created");
	if (encoderFactory) {
		const auto formats = encoderFactory->GetSupportedFormats();
		Expect(formats.size() == 1, "only the validated native H.264 format is advertised");
		if (formats.size() == 1) {
			Expect(formats.front().name == "H264", "the advertised codec is H.264");
			const auto packetization =
				formats.front().parameters.find("packetization-mode");
			const auto profile =
				formats.front().parameters.find("profile-level-id");
			Expect(
				packetization != formats.front().parameters.end() &&
					packetization->second == "1",
				"H.264 non-interleaved packetization is advertised");
			Expect(
				profile != formats.front().parameters.end() &&
					profile->second == "42e01f",
				"H.264 constrained baseline level 3.1 is advertised");
		}
	}

	Microsoft::WRL::ComPtr<ID3D11Texture2D> largeTexture;
	const D3D11_TEXTURE2D_DESC largeTextureDescription{
		.Width = 3840,
		.Height = 2160,
		.MipLevels = 1,
		.ArraySize = 1,
		.Format = DXGI_FORMAT_B8G8R8A8_UNORM,
		.SampleDesc = { .Count = 1, .Quality = 0 },
		.Usage = D3D11_USAGE_DEFAULT,
		.BindFlags = D3D11_BIND_RENDER_TARGET | D3D11_BIND_SHADER_RESOURCE,
		.CPUAccessFlags = 0,
		.MiscFlags = 0,
	};
	Expect(
		SUCCEEDED(device->CreateTexture2D(
			&largeTextureDescription,
			nullptr,
			&largeTexture)),
		"4K D3D11 test texture is created");
	if (largeTexture) {
		poio::share::NativeVideoSource scaledSource(60.0, 1920, 1080);
		FrameSink scaledSink;
		webrtc::VideoSinkWants wants;
		scaledSource.source()->AddOrUpdateSink(&scaledSink, wants);
		const auto scaledResult = scaledSource.PushTexture(
			largeTexture.Get(),
			3840,
			2160,
			std::chrono::steady_clock::now());
		Expect(
			scaledResult == poio::share::NativeVideoPushResult::Delivered,
			"4K source frame is GPU-scaled without rejection");
		Expect(
			scaledSink.frames == 1 &&
				scaledSink.width == 1920 &&
				scaledSink.height == 1080,
			"bounded source emits a true 1920x1080 frame");
		Expect(
			scaledSource.outputWidth() == 1920 &&
				scaledSource.outputHeight() == 1080,
			"bounded source reports its actual output dimensions");
		scaledSource.source()->RemoveSink(&scaledSink);

		poio::share::NativeVideoSource originalSource(60.0, 0, 0);
		FrameSink originalSink;
		originalSource.source()->AddOrUpdateSink(&originalSink, wants);
		const auto originalResult = originalSource.PushTexture(
			largeTexture.Get(),
			3840,
			2160,
			std::chrono::steady_clock::now());
		Expect(
			originalResult == poio::share::NativeVideoPushResult::Delivered,
			"original-resolution source frame is accepted");
		Expect(
			originalSink.frames == 1 &&
				originalSink.width == 3840 &&
				originalSink.height == 2160,
			"original mode preserves the native 4K dimensions");
		originalSource.source()->RemoveSink(&originalSink);
	}

	try {
		poio::share::NativeVideoSource source;
		poio::share::WebRtcRuntime runtime(device.Get(), "test-adapter");
		Expect(runtime.factory() != nullptr, "peer connection factory is created");
		const auto track = runtime.CreateVideoTrack(source, "poio-native-screen");
		Expect(track != nullptr, "GPU-native screen video track is created");
		if (track) {
			Expect(track->kind() == "video", "created media track is video");
		}
	} catch (const std::exception &error) {
		std::cerr << "FAILED: WebRTC runtime threw: " << error.what() << '\n';
		++failures;
	}

	if (failures == 0) {
		std::cout << "All POIO native WebRTC tests passed\n";
	}
	return failures == 0 ? 0 : 1;
}
