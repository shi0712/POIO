#pragma once

#include <chrono>
#include <cstdint>
#include <memory>
#include <string>

#include "poio/share/encoder.hpp"
#include "api/media_stream_interface.h"
#include "api/peer_connection_interface.h"
#include "api/scoped_refptr.h"
#include "api/video_codecs/video_encoder_factory.h"

struct ID3D11Device;
struct ID3D11Texture2D;

namespace poio::share {

enum class NativeVideoPushResult {
	Delivered,
	Paced,
	Rejected,
};

// Bridges GPU-native Windows Graphics Capture frames into a WebRTC video
// source. The texture is retained until all WebRTC consumers release the frame.
class NativeVideoSource {
public:
	NativeVideoSource();
	explicit NativeVideoSource(double maxFrameRate);
	NativeVideoSource(
		double maxFrameRate,
		std::uint32_t maxWidth,
		std::uint32_t maxHeight);
	~NativeVideoSource();

	NativeVideoSource(const NativeVideoSource &) = delete;
	NativeVideoSource &operator=(const NativeVideoSource &) = delete;
	NativeVideoSource(NativeVideoSource &&) noexcept;
	NativeVideoSource &operator=(NativeVideoSource &&) noexcept;

	[[nodiscard]] NativeVideoPushResult PushTexture(
		ID3D11Texture2D *texture,
		std::uint32_t width,
		std::uint32_t height,
		std::chrono::steady_clock::time_point capturedAt);

	[[nodiscard]] webrtc::scoped_refptr<webrtc::VideoTrackSourceInterface> source() const;
	[[nodiscard]] std::uint32_t outputWidth() const noexcept;
	[[nodiscard]] std::uint32_t outputHeight() const noexcept;

private:
	struct Impl;
	std::unique_ptr<Impl> impl_;
};

// Owns the native WebRTC network/worker/signaling threads and a peer
// connection factory configured with POIO's D3D11 hardware H.264 encoder.
class WebRtcRuntime {
public:
	WebRtcRuntime(ID3D11Device *device, std::string adapterName);
	WebRtcRuntime(
		ID3D11Device *device,
		std::string adapterName,
		ScreenContentMode contentMode);
	~WebRtcRuntime();

	WebRtcRuntime(const WebRtcRuntime &) = delete;
	WebRtcRuntime &operator=(const WebRtcRuntime &) = delete;
	WebRtcRuntime(WebRtcRuntime &&) noexcept;
	WebRtcRuntime &operator=(WebRtcRuntime &&) noexcept;

	[[nodiscard]] webrtc::scoped_refptr<webrtc::PeerConnectionFactoryInterface>
	factory() const;
	[[nodiscard]] webrtc::scoped_refptr<webrtc::VideoTrackInterface>
	CreateVideoTrack(NativeVideoSource &source, const std::string &label);

private:
	struct Impl;
	std::unique_ptr<Impl> impl_;
};

// Creates the only H.264 encoder advertised by the native share transport.
// It accepts D3D11 textures and routes WebRTC rate/keyframe feedback to the
// Media Foundation hardware encoder.
[[nodiscard]] std::unique_ptr<webrtc::VideoEncoderFactory>
CreateMfH264EncoderFactory(ID3D11Device *device, std::string adapterName);
[[nodiscard]] std::unique_ptr<webrtc::VideoEncoderFactory>
CreateMfH264EncoderFactory(
	ID3D11Device *device,
	std::string adapterName,
	ScreenContentMode contentMode);

} // namespace poio::share
