#include "poio/share/webrtc.hpp"

#include "poio/share/encoder.hpp"

#include <d3d11.h>
#include <wrl/client.h>

#include <algorithm>
#include <array>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <deque>
#include <limits>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

#include "api/make_ref_counted.h"
#include "api/audio_codecs/builtin_audio_decoder_factory.h"
#include "api/audio_codecs/builtin_audio_encoder_factory.h"
#include "api/create_peerconnection_factory.h"
#include "api/units/timestamp.h"
#include "api/video/encoded_image.h"
#include "api/video/video_content_type.h"
#include "api/video/video_frame.h"
#include "api/video/video_frame_buffer.h"
#include "api/video/video_frame_type.h"
#include "api/video_codecs/sdp_video_format.h"
#include "api/video_codecs/video_decoder_factory.h"
#include "api/video_codecs/video_codec.h"
#include "api/video_codecs/video_encoder.h"
#include "media/base/adapted_video_track_source.h"
#include "modules/video_coding/codecs/h264/include/h264_globals.h"
#include "modules/video_coding/codecs/interface/common_constants.h"
#include "modules/video_coding/include/video_codec_interface.h"
#include "modules/video_coding/include/video_error_codes.h"
#include "rtc_base/time_utils.h"
#include "rtc_base/ssl_adapter.h"
#include "rtc_base/thread.h"
#include "rtc_base/win32_socket_init.h"

namespace poio::share {
namespace {

constexpr char kH264CodecName[] = "H264";
constexpr char kH264ProfileLevelId[] = "42e01f";
constexpr std::uint32_t kDefaultBitrate = 12'000'000;
constexpr std::uint32_t kMinimumHardwareBitrate = 500'000;
constexpr std::uint32_t kDefaultFrameRate = 60;
constexpr std::uint32_t kDefaultKeyFrameInterval = 120;

std::mutex sslMutex;
std::size_t sslReferenceCount = 0;

void AcquireSsl() {
	std::lock_guard lock(sslMutex);
	if (sslReferenceCount == 0 && !webrtc::InitializeSSL()) {
		throw std::runtime_error("WebRTC SSL initialization failed");
	}
	++sslReferenceCount;
}

void ReleaseSsl() noexcept {
	std::lock_guard lock(sslMutex);
	if (sslReferenceCount == 0) {
		return;
	}
	--sslReferenceCount;
	if (sslReferenceCount == 0) {
		(void)webrtc::CleanupSSL();
	}
}

webrtc::SdpVideoFormat NativeH264Format() {
	return webrtc::SdpVideoFormat(
		kH264CodecName,
		{
			{ "level-asymmetry-allowed", "1" },
			{ "packetization-mode", "1" },
			{ "profile-level-id", kH264ProfileLevelId },
		});
}

class OwnedEncodedImageBuffer
	: public webrtc::EncodedImageBufferInterface {
public:
	explicit OwnedEncodedImageBuffer(std::vector<std::uint8_t> bytes)
		: bytes_(std::move(bytes)) {}

	~OwnedEncodedImageBuffer() override = default;

	const std::uint8_t *data() const override {
		return bytes_.data();
	}

	std::uint8_t *data() override {
		return bytes_.data();
	}

	std::size_t size() const override {
		return bytes_.size();
	}

private:
	std::vector<std::uint8_t> bytes_;
};

class D3D11TextureBuffer : public webrtc::VideoFrameBuffer {
public:
	D3D11TextureBuffer(
		ID3D11Texture2D *texture,
		const int width,
		const int height,
		const std::chrono::steady_clock::time_point capturedAt,
		std::shared_ptr<void> lifetime = {})
		: texture_(texture),
		  width_(width),
		  height_(height),
		  capturedAt_(capturedAt),
		  lifetime_(std::move(lifetime)) {}

	~D3D11TextureBuffer() override = default;

	Type type() const override {
		return Type::kNative;
	}

	int width() const override {
		return width_;
	}

	int height() const override {
		return height_;
	}

	webrtc::scoped_refptr<webrtc::I420BufferInterface> ToI420() override {
		// The POIO encoder consumes the native D3D11 texture. A CPU conversion
		// here would add a GPU readback and defeat the zero-copy path.
		return nullptr;
	}

	webrtc::scoped_refptr<webrtc::VideoFrameBuffer> CropAndScale(
		const int offsetX,
		const int offsetY,
		const int cropWidth,
		const int cropHeight,
		const int scaledWidth,
		const int scaledHeight) override {
		const bool noOp =
			offsetX == 0 &&
			offsetY == 0 &&
			cropWidth == width_ &&
			cropHeight == height_ &&
			scaledWidth == width_ &&
			scaledHeight == height_;
		if (!noOp) {
			return nullptr;
		}
		return webrtc::scoped_refptr<webrtc::VideoFrameBuffer>(this);
	}

	[[nodiscard]] ID3D11Texture2D *texture() const noexcept {
		return texture_.Get();
	}

	[[nodiscard]] std::chrono::steady_clock::time_point capturedAt() const noexcept {
		return capturedAt_;
	}

private:
	Microsoft::WRL::ComPtr<ID3D11Texture2D> texture_;
	int width_ = 0;
	int height_ = 0;
	std::chrono::steady_clock::time_point capturedAt_;
	std::shared_ptr<void> lifetime_;
};

class D3D11TextureScaler {
public:
	struct ScaledTexture {
		Microsoft::WRL::ComPtr<ID3D11Texture2D> texture;
		std::shared_ptr<void> lifetime;
	};

	[[nodiscard]] std::optional<ScaledTexture> Scale(
		ID3D11Texture2D *input,
		const std::uint32_t inputWidth,
		const std::uint32_t inputHeight,
		const std::uint32_t outputWidth,
		const std::uint32_t outputHeight) {
		if (input == nullptr || outputWidth == 0 || outputHeight == 0) {
			return std::nullopt;
		}

		std::lock_guard lock(mutex_);
		D3D11_TEXTURE2D_DESC inputDescription{};
		input->GetDesc(&inputDescription);
		Microsoft::WRL::ComPtr<ID3D11Device> device;
		input->GetDevice(&device);
		if (!device) {
			return std::nullopt;
		}

		if (!state_ ||
			state_->device.Get() != device.Get() ||
			state_->inputWidth != inputWidth ||
			state_->inputHeight != inputHeight ||
			state_->outputWidth != outputWidth ||
			state_->outputHeight != outputHeight ||
			state_->format != inputDescription.Format) {
			state_ = CreateState(
				device.Get(),
				inputDescription,
				inputWidth,
				inputHeight,
				outputWidth,
				outputHeight);
		}
		if (!state_) {
			return std::nullopt;
		}

		std::size_t slotIndex = kTexturePoolSize;
		for (std::size_t index = 0; index < state_->slots.size(); ++index) {
			bool expected = false;
			if (state_->slots[index].inUse.compare_exchange_strong(
					expected,
					true,
					std::memory_order_acq_rel,
					std::memory_order_relaxed)) {
				slotIndex = index;
				break;
			}
		}
		if (slotIndex == kTexturePoolSize) {
			return std::nullopt;
		}

		const auto activeState = state_;
		auto &slot = activeState->slots[slotIndex];
		Microsoft::WRL::ComPtr<ID3D11VideoProcessorInputView> inputView;
		const D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC inputViewDescription{
			.FourCC = 0,
			.ViewDimension = D3D11_VPIV_DIMENSION_TEXTURE2D,
			.Texture2D = {
				.MipSlice = 0,
				.ArraySlice = 0,
			},
		};
		const HRESULT inputViewResult =
			activeState->videoDevice->CreateVideoProcessorInputView(
				input,
				activeState->enumerator.Get(),
				&inputViewDescription,
				&inputView);
		if (FAILED(inputViewResult)) {
			slot.inUse.store(false, std::memory_order_release);
			return std::nullopt;
		}

		const RECT sourceRect{
			.left = 0,
			.top = 0,
			.right = static_cast<LONG>(inputWidth),
			.bottom = static_cast<LONG>(inputHeight),
		};
		const RECT destinationRect{
			.left = 0,
			.top = 0,
			.right = static_cast<LONG>(outputWidth),
			.bottom = static_cast<LONG>(outputHeight),
		};
		activeState->videoContext->VideoProcessorSetOutputTargetRect(
			activeState->processor.Get(),
			TRUE,
			&destinationRect);
		activeState->videoContext->VideoProcessorSetStreamFrameFormat(
			activeState->processor.Get(),
			0,
			D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE);
		activeState->videoContext->VideoProcessorSetStreamSourceRect(
			activeState->processor.Get(),
			0,
			TRUE,
			&sourceRect);
		activeState->videoContext->VideoProcessorSetStreamDestRect(
			activeState->processor.Get(),
			0,
			TRUE,
			&destinationRect);
		D3D11_VIDEO_PROCESSOR_STREAM stream{
			.Enable = TRUE,
			.OutputIndex = 0,
			.InputFrameOrField = 0,
			.PastFrames = 0,
			.FutureFrames = 0,
			.ppPastSurfaces = nullptr,
			.pInputSurface = inputView.Get(),
			.ppFutureSurfaces = nullptr,
			.ppPastSurfacesRight = nullptr,
			.pInputSurfaceRight = nullptr,
			.ppFutureSurfacesRight = nullptr,
		};
		const HRESULT blitResult = activeState->videoContext->VideoProcessorBlt(
			activeState->processor.Get(),
			slot.outputView.Get(),
			frameNumber_++,
			1,
			&stream);
		if (FAILED(blitResult)) {
			slot.inUse.store(false, std::memory_order_release);
			return std::nullopt;
		}

		auto lease = std::shared_ptr<void>(
			new Lease{ activeState, slotIndex },
			[](void *value) {
				delete static_cast<Lease *>(value);
			});
		return ScaledTexture{
			.texture = slot.texture,
			.lifetime = std::move(lease),
		};
	}

private:
	static constexpr std::size_t kTexturePoolSize = 6;

	struct Slot {
		std::atomic_bool inUse{ false };
		Microsoft::WRL::ComPtr<ID3D11Texture2D> texture;
		Microsoft::WRL::ComPtr<ID3D11VideoProcessorOutputView> outputView;
	};

	struct State {
		Microsoft::WRL::ComPtr<ID3D11Device> device;
		Microsoft::WRL::ComPtr<ID3D11VideoDevice> videoDevice;
		Microsoft::WRL::ComPtr<ID3D11VideoContext> videoContext;
		Microsoft::WRL::ComPtr<ID3D11VideoProcessorEnumerator> enumerator;
		Microsoft::WRL::ComPtr<ID3D11VideoProcessor> processor;
		std::array<Slot, kTexturePoolSize> slots;
		std::uint32_t inputWidth = 0;
		std::uint32_t inputHeight = 0;
		std::uint32_t outputWidth = 0;
		std::uint32_t outputHeight = 0;
		DXGI_FORMAT format = DXGI_FORMAT_UNKNOWN;
	};

	struct Lease {
		std::shared_ptr<State> state;
		std::size_t slotIndex = 0;

		~Lease() {
			if (state && slotIndex < state->slots.size()) {
				state->slots[slotIndex].inUse.store(
					false,
					std::memory_order_release);
			}
		}
	};

	static std::shared_ptr<State> CreateState(
		ID3D11Device *device,
		const D3D11_TEXTURE2D_DESC &inputDescription,
		const std::uint32_t inputWidth,
		const std::uint32_t inputHeight,
		const std::uint32_t outputWidth,
		const std::uint32_t outputHeight) {
		auto state = std::make_shared<State>();
		state->device = device;
		state->inputWidth = inputWidth;
		state->inputHeight = inputHeight;
		state->outputWidth = outputWidth;
		state->outputHeight = outputHeight;
		state->format = inputDescription.Format;
		Microsoft::WRL::ComPtr<ID3D11DeviceContext> context;
		device->GetImmediateContext(&context);
		if (!context ||
			FAILED(device->QueryInterface(IID_PPV_ARGS(&state->videoDevice))) ||
			FAILED(context.As(&state->videoContext))) {
			return nullptr;
		}

		const D3D11_VIDEO_PROCESSOR_CONTENT_DESC contentDescription{
			.InputFrameFormat = D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE,
			.InputFrameRate = { 60, 1 },
			.InputWidth = inputWidth,
			.InputHeight = inputHeight,
			.OutputFrameRate = { 60, 1 },
			.OutputWidth = outputWidth,
			.OutputHeight = outputHeight,
			.Usage = D3D11_VIDEO_USAGE_OPTIMAL_QUALITY,
		};
		if (FAILED(state->videoDevice->CreateVideoProcessorEnumerator(
				&contentDescription,
				&state->enumerator))) {
			return nullptr;
		}
		UINT formatSupport = 0;
		if (FAILED(state->enumerator->CheckVideoProcessorFormat(
				inputDescription.Format,
				&formatSupport)) ||
			(formatSupport & D3D11_VIDEO_PROCESSOR_FORMAT_SUPPORT_INPUT) == 0 ||
			(formatSupport & D3D11_VIDEO_PROCESSOR_FORMAT_SUPPORT_OUTPUT) == 0 ||
			FAILED(state->videoDevice->CreateVideoProcessor(
				state->enumerator.Get(),
				0,
				&state->processor))) {
			return nullptr;
		}

		D3D11_TEXTURE2D_DESC outputDescription = inputDescription;
		outputDescription.Width = outputWidth;
		outputDescription.Height = outputHeight;
		outputDescription.MipLevels = 1;
		outputDescription.ArraySize = 1;
		outputDescription.SampleDesc = { 1, 0 };
		outputDescription.Usage = D3D11_USAGE_DEFAULT;
		outputDescription.BindFlags =
			D3D11_BIND_RENDER_TARGET | D3D11_BIND_SHADER_RESOURCE;
		outputDescription.CPUAccessFlags = 0;
		outputDescription.MiscFlags = 0;
		const D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC outputViewDescription{
			.ViewDimension = D3D11_VPOV_DIMENSION_TEXTURE2D,
			.Texture2D = { .MipSlice = 0 },
		};
		for (auto &slot : state->slots) {
			if (FAILED(device->CreateTexture2D(
					&outputDescription,
					nullptr,
					&slot.texture)) ||
				FAILED(state->videoDevice->CreateVideoProcessorOutputView(
					slot.texture.Get(),
					state->enumerator.Get(),
					&outputViewDescription,
					&slot.outputView))) {
				return nullptr;
			}
		}
		return state;
	}

	std::mutex mutex_;
	std::shared_ptr<State> state_;
	UINT frameNumber_ = 0;
};

class D3D11VideoTrackSource : public webrtc::AdaptedVideoTrackSource {
public:
	D3D11VideoTrackSource(
		const double maxFrameRate,
		const std::uint32_t maxWidth,
		const std::uint32_t maxHeight)
		: frameInterval_(
			  std::chrono::duration_cast<std::chrono::steady_clock::duration>(
				  std::chrono::duration<double>(
					  1.0 / std::clamp(maxFrameRate, 1.0, 240.0)))),
		  maxWidth_(maxWidth),
		  maxHeight_(maxHeight) {}
	~D3D11VideoTrackSource() override = default;

	SourceState state() const override {
		return live_.load(std::memory_order_acquire) ? kLive : kEnded;
	}

	bool remote() const override {
		return false;
	}

	bool is_screencast() const override {
		return true;
	}

	std::optional<bool> needs_denoising() const override {
		return false;
	}

	NativeVideoPushResult Push(
		ID3D11Texture2D *texture,
		const std::uint32_t width,
		const std::uint32_t height,
		const std::chrono::steady_clock::time_point capturedAt) {
		if (!live_.load(std::memory_order_acquire) ||
			texture == nullptr || width == 0 || height == 0 ||
			width > static_cast<std::uint32_t>(std::numeric_limits<int>::max()) ||
			height > static_cast<std::uint32_t>(std::numeric_limits<int>::max())) {
			return NativeVideoPushResult::Rejected;
		}

		// WGC follows the monitor refresh rate (75/120/144 Hz are common),
		// while the selected POIO profile is intentionally capped at 30 or
		// 60 fps. Feed WebRTC at that exact cadence so its single encoder
		// queue always receives the freshest frame instead of accumulating
		// stale GPU textures. Advancing an absolute deadline avoids the
		// 75 -> 37.5 fps aliasing caused by "last frame + interval" pacing.
		{
			std::lock_guard lock(pacingMutex_);
			if (nextFrameAt_ != std::chrono::steady_clock::time_point{} &&
				capturedAt < nextFrameAt_) {
				return NativeVideoPushResult::Paced;
			}

			if (nextFrameAt_ == std::chrono::steady_clock::time_point{} ||
				capturedAt - nextFrameAt_ > frameInterval_ * 4) {
				nextFrameAt_ = capturedAt + frameInterval_;
			} else {
				do {
					nextFrameAt_ += frameInterval_;
				} while (nextFrameAt_ <= capturedAt);
			}
		}

		const auto age = std::max(
			std::chrono::steady_clock::duration::zero(),
			std::chrono::steady_clock::now() - capturedAt);
		const auto ageUs = std::chrono::duration_cast<std::chrono::microseconds>(age).count();
		const std::int64_t measuredTimestampUs = webrtc::TimeMicros() - ageUs;
		// `steady_clock` and WebRTC's clock are sampled independently. On
		// Windows their sub-microsecond rounding can make a later capture look
		// equal to, or one microsecond older than, the previous frame. WebRTC
		// rejects such frames before they reach the encoder. Keep both the
		// capture timestamp and its 90 kHz RTP projection strictly monotonic.
		std::int64_t previousTimestampUs =
			lastTimestampUs_.load(std::memory_order_relaxed);
		std::int64_t timestampUs = 0;
		do {
			timestampUs = std::max(
				measuredTimestampUs,
				previousTimestampUs + kMinimumTimestampStepUs);
		} while (!lastTimestampUs_.compare_exchange_weak(
			previousTimestampUs,
			timestampUs,
			std::memory_order_relaxed,
			std::memory_order_relaxed));
		const auto rtpTimestamp = static_cast<std::uint32_t>(
			(static_cast<std::uint64_t>(timestampUs) * 90ULL) / 1'000ULL);

		const auto [outputWidth, outputHeight] =
			OutputDimensions(width, height, maxWidth_, maxHeight_);
		ID3D11Texture2D *outputTexture = texture;
		std::shared_ptr<void> scaledTextureLifetime;
		if (outputWidth != width || outputHeight != height) {
			auto scaled = scaler_.Scale(
				texture,
				width,
				height,
				outputWidth,
				outputHeight);
			if (!scaled) {
				return NativeVideoPushResult::Rejected;
			}
			outputTexture = scaled->texture.Get();
			scaledTextureLifetime = std::move(scaled->lifetime);
		}
		auto buffer = webrtc::make_ref_counted<D3D11TextureBuffer>(
			outputTexture,
			static_cast<int>(outputWidth),
			static_cast<int>(outputHeight),
			capturedAt,
			std::move(scaledTextureLifetime));
		auto frame = webrtc::VideoFrame::Builder()
						 .set_video_frame_buffer(buffer)
						 .set_timestamp_us(timestampUs)
						 .set_rtp_timestamp(rtpTimestamp)
						 .set_rotation(webrtc::kVideoRotation_0)
						 .build();
		OnFrame(frame);
		outputWidth_.store(outputWidth, std::memory_order_relaxed);
		outputHeight_.store(outputHeight, std::memory_order_relaxed);
		return NativeVideoPushResult::Delivered;
	}

	void End() {
		live_.store(false, std::memory_order_release);
	}

	[[nodiscard]] std::uint32_t outputWidth() const noexcept {
		return outputWidth_.load(std::memory_order_relaxed);
	}

	[[nodiscard]] std::uint32_t outputHeight() const noexcept {
		return outputHeight_.load(std::memory_order_relaxed);
	}

private:
	static std::pair<std::uint32_t, std::uint32_t> OutputDimensions(
		const std::uint32_t inputWidth,
		const std::uint32_t inputHeight,
		const std::uint32_t maxWidth,
		const std::uint32_t maxHeight) {
		if ((maxWidth == 0 && maxHeight == 0) ||
			((maxWidth == 0 || inputWidth <= maxWidth) &&
			 (maxHeight == 0 || inputHeight <= maxHeight))) {
			return { inputWidth, inputHeight };
		}
		const double widthScale =
			maxWidth == 0
				? 1.0
				: static_cast<double>(maxWidth) / inputWidth;
		const double heightScale =
			maxHeight == 0
				? 1.0
				: static_cast<double>(maxHeight) / inputHeight;
		const double scale = std::min({ 1.0, widthScale, heightScale });
		auto outputWidth = static_cast<std::uint32_t>(
			std::floor(inputWidth * scale));
		auto outputHeight = static_cast<std::uint32_t>(
			std::floor(inputHeight * scale));
		outputWidth = std::max<std::uint32_t>(2, outputWidth & ~1U);
		outputHeight = std::max<std::uint32_t>(2, outputHeight & ~1U);
		return { outputWidth, outputHeight };
	}

	// VideoStreamEncoder validates the millisecond NTP projection, not just
	// the microsecond capture timestamp.
	static constexpr std::int64_t kMinimumTimestampStepUs = 1'000;
	std::atomic_bool live_{ true };
	std::atomic<std::int64_t> lastTimestampUs_{ 0 };
	const std::chrono::steady_clock::duration frameInterval_;
	const std::uint32_t maxWidth_;
	const std::uint32_t maxHeight_;
	D3D11TextureScaler scaler_;
	std::atomic_uint32_t outputWidth_{ 0 };
	std::atomic_uint32_t outputHeight_{ 0 };
	std::mutex pacingMutex_;
	std::chrono::steady_clock::time_point nextFrameAt_;
};

class MfH264Encoder final : public webrtc::VideoEncoder {
public:
	MfH264Encoder(
		ID3D11Device *device,
		std::string adapterName,
		const ScreenContentMode contentMode)
		: device_(device),
		  adapterName_(std::move(adapterName)),
		  contentMode_(contentMode) {}

	~MfH264Encoder() override {
		Release();
	}

	int InitEncode(
		const webrtc::VideoCodec *codecSettings,
		const webrtc::VideoEncoder::Settings & /*settings*/) override {
		if (codecSettings == nullptr ||
			codecSettings->codecType != webrtc::kVideoCodecH264 ||
			codecSettings->width == 0 ||
			codecSettings->height == 0 ||
			codecSettings->numberOfSimulcastStreams > 1 ||
			device_ == nullptr) {
			return WEBRTC_VIDEO_CODEC_ERR_PARAMETER;
		}

		Release();
		width_ = codecSettings->width;
		height_ = codecSettings->height;
		frameRate_ = std::max<std::uint32_t>(
			1,
			codecSettings->maxFramerate == 0
				? kDefaultFrameRate
				: codecSettings->maxFramerate);
		targetBitrate_ = std::max(
			kMinimumHardwareBitrate,
			codecSettings->startBitrate == 0
				? kDefaultBitrate
				: codecSettings->startBitrate * 1'000U);
		const auto keyFrameInterval = codecSettings->H264().keyFrameInterval <= 0
			? kDefaultKeyFrameInterval
			: static_cast<std::uint32_t>(codecSettings->H264().keyFrameInterval);

		try {
			session_ = std::make_unique<HardwareEncoderSession>(
				device_.Get(),
				HardwareEncoderConfig{
					.adapterName = adapterName_,
					.width = width_,
					.height = height_,
					.frameRate = frameRate_,
					.bitrate = targetBitrate_,
					.keyFrameInterval = keyFrameInterval,
					.profile = H264Profile::ConstrainedBaseline,
					.contentMode = contentMode_,
				},
				[this](EncodedAccessUnit &&accessUnit) {
					DeliverEncodedAccessUnit(std::move(accessUnit));
				});
		} catch (...) {
			session_.reset();
			return WEBRTC_VIDEO_CODEC_ERROR;
		}
		return WEBRTC_VIDEO_CODEC_OK;
	}

	std::int32_t RegisterEncodeCompleteCallback(
		webrtc::EncodedImageCallback *callback) override {
		std::lock_guard lock(mutex_);
		callback_ = callback;
		return WEBRTC_VIDEO_CODEC_OK;
	}

	std::int32_t Release() override {
		if (session_) {
			try {
				session_->Finish();
			} catch (...) {
			}
			session_.reset();
		}
		std::lock_guard lock(mutex_);
		pendingFrames_.clear();
		pendingFrameOrder_.clear();
		return WEBRTC_VIDEO_CODEC_OK;
	}

	std::int32_t Encode(
		const webrtc::VideoFrame &frame,
		const std::vector<webrtc::VideoFrameType> *frameTypes) override {
		if (!session_) {
			return WEBRTC_VIDEO_CODEC_UNINITIALIZED;
		}

		auto *nativeBuffer =
			dynamic_cast<D3D11TextureBuffer *>(frame.video_frame_buffer().get());
		if (nativeBuffer == nullptr ||
			nativeBuffer->texture() == nullptr ||
			frame.width() != static_cast<int>(width_) ||
			frame.height() != static_cast<int>(height_)) {
			return WEBRTC_VIDEO_CODEC_ERR_PARAMETER;
		}

		bool requestKeyFrame = false;
		if (frameTypes != nullptr) {
			requestKeyFrame = std::find(
				frameTypes->begin(),
				frameTypes->end(),
				webrtc::VideoFrameType::kVideoFrameKey) != frameTypes->end();
		}
		if (requestKeyFrame) {
			(void)session_->RequestKeyFrame();
		}

		{
			std::lock_guard lock(mutex_);
			while (pendingFrameOrder_.size() >= kMaximumPendingFrames) {
				pendingFrames_.erase(pendingFrameOrder_.front());
				pendingFrameOrder_.pop_front();
			}
			pendingFrames_[frame.rtp_timestamp()] = PendingFrame{
				.timestampUs = frame.timestamp_us(),
				.rotation = frame.rotation(),
				.colorSpace = frame.color_space(),
			};
			pendingFrameOrder_.push_back(frame.rtp_timestamp());
		}

		try {
			session_->Encode(
				nativeBuffer->texture(),
				nativeBuffer->capturedAt(),
				frame.rtp_timestamp());
			session_->Pump();
		} catch (...) {
			std::lock_guard lock(mutex_);
			pendingFrames_.erase(frame.rtp_timestamp());
			return WEBRTC_VIDEO_CODEC_ERROR;
		}
		return WEBRTC_VIDEO_CODEC_OK;
	}

	void SetRates(const RateControlParameters &parameters) override {
		const auto requestedBitrate = parameters.bitrate.get_sum_bps();
		if (requestedBitrate == 0) {
			return;
		}
		targetBitrate_ = std::max(
			kMinimumHardwareBitrate,
			requestedBitrate);
		if (parameters.framerate_fps > 0.0) {
			frameRate_ = std::max<std::uint32_t>(
				1,
				static_cast<std::uint32_t>(parameters.framerate_fps + 0.5));
		}
		if (session_) {
			(void)session_->SetTargetBitrate(targetBitrate_);
		}
	}

	EncoderInfo GetEncoderInfo() const override {
		EncoderInfo info;
		info.supports_native_handle = true;
		info.implementation_name = "POIO Media Foundation D3D11 H.264";
		// The selected Media Foundation MFT is configured for low-delay VBR
		// and accepts dynamic mean-bitrate updates. Let it preserve cadence
		// at the BWE target instead of applying WebRTC's second frame dropper
		// on top of the hardware rate controller.
		info.has_trusted_rate_controller = true;
		info.is_hardware_accelerated = true;
		info.supports_simulcast = false;
		info.requested_resolution_alignment = 2;
		info.apply_alignment_to_all_simulcast_layers = false;
		info.scaling_settings = ScalingSettings::kOff;
		return info;
	}

private:
	struct PendingFrame {
		std::int64_t timestampUs = 0;
		webrtc::VideoRotation rotation = webrtc::kVideoRotation_0;
		std::optional<webrtc::ColorSpace> colorSpace;
	};

	void DeliverEncodedAccessUnit(EncodedAccessUnit &&accessUnit) {
		webrtc::EncodedImageCallback *callback = nullptr;
		PendingFrame pending;
		bool foundPendingFrame = false;
		{
			std::lock_guard lock(mutex_);
			callback = callback_;
			const auto it = pendingFrames_.find(accessUnit.rtpTimestamp90Khz);
			if (it != pendingFrames_.end()) {
				pending = std::move(it->second);
				pendingFrames_.erase(it);
				foundPendingFrame = true;
			}
		}
		if (callback == nullptr || accessUnit.bytes.empty()) {
			return;
		}
		if (!foundPendingFrame) {
			pending.timestampUs = webrtc::TimeMicros();
		}

		webrtc::EncodedImage image;
		image.SetEncodedData(
			webrtc::make_ref_counted<OwnedEncodedImageBuffer>(
				std::move(accessUnit.bytes)));
		image.SetRtpTimestamp(accessUnit.rtpTimestamp90Khz);
		image._encodedWidth = accessUnit.width;
		image._encodedHeight = accessUnit.height;
		image.capture_time_ms_ = pending.timestampUs / 1'000;
		image.SetPresentationTimestamp(
			webrtc::Timestamp::Micros(pending.timestampUs));
		image.rotation_ = pending.rotation;
		image.SetColorSpace(pending.colorSpace);
		image.content_type_ = webrtc::VideoContentType::SCREENSHARE;
		image.SetFrameType(
			accessUnit.keyFrame
				? webrtc::VideoFrameType::kVideoFrameKey
				: webrtc::VideoFrameType::kVideoFrameDelta);
		const auto finishMs = webrtc::TimeMillis();
		const auto encodeDurationMs = static_cast<std::int64_t>(
			std::max(0.0, accessUnit.encodeLatencyMs) + 0.5);
		image.SetEncodeTime(finishMs - encodeDurationMs, finishMs);

		webrtc::CodecSpecificInfo codecSpecific;
		codecSpecific.codecType = webrtc::kVideoCodecH264;
		codecSpecific.codecSpecific.H264.packetization_mode =
			webrtc::H264PacketizationMode::NonInterleaved;
		codecSpecific.codecSpecific.H264.temporal_idx = webrtc::kNoTemporalIdx;
		codecSpecific.codecSpecific.H264.base_layer_sync = false;
		codecSpecific.codecSpecific.H264.idr_frame = accessUnit.containsIdr;
		callback->OnEncodedImage(image, &codecSpecific);
	}

	Microsoft::WRL::ComPtr<ID3D11Device> device_;
	std::string adapterName_;
	ScreenContentMode contentMode_{ ScreenContentMode::Motion };
	std::unique_ptr<HardwareEncoderSession> session_;
	std::uint32_t width_ = 0;
	std::uint32_t height_ = 0;
	std::uint32_t frameRate_ = kDefaultFrameRate;
	std::uint32_t targetBitrate_ = kDefaultBitrate;
	mutable std::mutex mutex_;
	webrtc::EncodedImageCallback *callback_ = nullptr;
	static constexpr std::size_t kMaximumPendingFrames = 512;
	std::map<std::uint32_t, PendingFrame> pendingFrames_;
	std::deque<std::uint32_t> pendingFrameOrder_;
};

class MfH264EncoderFactory final : public webrtc::VideoEncoderFactory {
public:
	MfH264EncoderFactory(
		ID3D11Device *device,
		std::string adapterName,
		const ScreenContentMode contentMode)
		: device_(device),
		  adapterName_(std::move(adapterName)),
		  contentMode_(contentMode) {}

	std::vector<webrtc::SdpVideoFormat> GetSupportedFormats() const override {
		return { NativeH264Format() };
	}

	CodecSupport QueryCodecSupport(
		const webrtc::SdpVideoFormat &format,
		const std::optional<std::string> scalabilityMode) const override {
		const bool supported =
			!scalabilityMode &&
			format.IsCodecInList(GetSupportedFormats());
		return CodecSupport{
			.is_supported = supported,
			.is_power_efficient = supported,
		};
	}

	std::unique_ptr<webrtc::VideoEncoder> Create(
		const webrtc::Environment & /*environment*/,
		const webrtc::SdpVideoFormat &format) override {
		if (!format.IsCodecInList(GetSupportedFormats())) {
			return nullptr;
		}
		return std::make_unique<MfH264Encoder>(
			device_.Get(),
			adapterName_,
			contentMode_);
	}

private:
	Microsoft::WRL::ComPtr<ID3D11Device> device_;
	std::string adapterName_;
	ScreenContentMode contentMode_{ ScreenContentMode::Motion };
};

class SendOnlyVideoDecoderFactory final : public webrtc::VideoDecoderFactory {
public:
	std::vector<webrtc::SdpVideoFormat> GetSupportedFormats() const override {
		// libmediasoupclient obtains the native RTP capabilities by creating a
		// temporary sendrecv transceiver. WebRTC only includes codecs that the
		// transceiver can negotiate in that offer, so the send-only runtime must
		// expose the matching receive format as a capability as well. No decoder
		// is ever instantiated by the publisher's send-only transceiver.
		return { NativeH264Format() };
	}

	std::unique_ptr<webrtc::VideoDecoder> Create(
		const webrtc::Environment & /*environment*/,
		const webrtc::SdpVideoFormat & /*format*/) override {
		return nullptr;
	}
};

} // namespace

struct NativeVideoSource::Impl {
	Impl(
		const double maxFrameRate,
		const std::uint32_t maxWidth,
		const std::uint32_t maxHeight)
		: trackSource(
			  webrtc::make_ref_counted<D3D11VideoTrackSource>(
				  maxFrameRate,
				  maxWidth,
				  maxHeight)) {}

	webrtc::scoped_refptr<D3D11VideoTrackSource> trackSource;

	~Impl() {
		if (trackSource) {
			trackSource->End();
		}
	}
};

NativeVideoSource::NativeVideoSource()
	: NativeVideoSource(60.0, 0, 0) {}

NativeVideoSource::NativeVideoSource(const double maxFrameRate)
	: NativeVideoSource(maxFrameRate, 0, 0) {}

NativeVideoSource::NativeVideoSource(
	const double maxFrameRate,
	const std::uint32_t maxWidth,
	const std::uint32_t maxHeight)
	: impl_(std::make_unique<Impl>(
		  maxFrameRate,
		  maxWidth,
		  maxHeight)) {}

NativeVideoSource::~NativeVideoSource() = default;

NativeVideoSource::NativeVideoSource(NativeVideoSource &&) noexcept = default;
NativeVideoSource &NativeVideoSource::operator=(NativeVideoSource &&) noexcept = default;

NativeVideoPushResult NativeVideoSource::PushTexture(
	ID3D11Texture2D *texture,
	const std::uint32_t width,
	const std::uint32_t height,
	const std::chrono::steady_clock::time_point capturedAt) {
	if (!impl_ || !impl_->trackSource) {
		return NativeVideoPushResult::Rejected;
	}
	return impl_->trackSource->Push(texture, width, height, capturedAt);
}

webrtc::scoped_refptr<webrtc::VideoTrackSourceInterface>
NativeVideoSource::source() const {
	if (!impl_) {
		return nullptr;
	}
	return impl_->trackSource;
}

std::uint32_t NativeVideoSource::outputWidth() const noexcept {
	return impl_ && impl_->trackSource
		? impl_->trackSource->outputWidth()
		: 0;
}

std::uint32_t NativeVideoSource::outputHeight() const noexcept {
	return impl_ && impl_->trackSource
		? impl_->trackSource->outputHeight()
		: 0;
}

std::unique_ptr<webrtc::VideoEncoderFactory>
CreateMfH264EncoderFactory(ID3D11Device *device, std::string adapterName) {
	return CreateMfH264EncoderFactory(
		device,
		std::move(adapterName),
		ScreenContentMode::Motion);
}

std::unique_ptr<webrtc::VideoEncoderFactory>
CreateMfH264EncoderFactory(
	ID3D11Device *device,
	std::string adapterName,
	const ScreenContentMode contentMode) {
	if (device == nullptr) {
		return nullptr;
	}
	return std::make_unique<MfH264EncoderFactory>(
		device,
		std::move(adapterName),
		contentMode);
}

struct WebRtcRuntime::Impl {
	explicit Impl(
		ID3D11Device *device,
		std::string adapterName,
		const ScreenContentMode contentMode) {
		if (winsock.error() != 0) {
			throw std::runtime_error(
				"Windows network initialization failed: " +
				std::to_string(winsock.error()));
		}
		AcquireSsl();
		sslAcquired = true;
		try {
			networkThread = webrtc::Thread::CreateWithSocketServer();
			workerThread = webrtc::Thread::Create();
			signalingThread = webrtc::Thread::Create();
			if (!networkThread || !workerThread || !signalingThread) {
				throw std::runtime_error("WebRTC thread allocation failed");
			}
			networkThread->SetName("poio-share-network", nullptr);
			workerThread->SetName("poio-share-worker", nullptr);
			signalingThread->SetName("poio-share-signaling", nullptr);
			if (!networkThread->Start() ||
				!workerThread->Start() ||
				!signalingThread->Start()) {
				throw std::runtime_error("WebRTC thread startup failed");
			}

			peerConnectionFactory = webrtc::CreatePeerConnectionFactory(
				networkThread.get(),
				workerThread.get(),
				signalingThread.get(),
				nullptr,
				webrtc::CreateBuiltinAudioEncoderFactory(),
				webrtc::CreateBuiltinAudioDecoderFactory(),
				CreateMfH264EncoderFactory(
					device,
					std::move(adapterName),
					contentMode),
				std::make_unique<SendOnlyVideoDecoderFactory>(),
				nullptr,
				nullptr);
			if (!peerConnectionFactory) {
				throw std::runtime_error("WebRTC peer connection factory creation failed");
			}
			webrtc::PeerConnectionFactoryInterface::Options factoryOptions;
			// Keep loopback available for the isolated local SFU/P2P test path.
			// Public sessions still prefer normal host/reflexive/relay candidates.
			factoryOptions.network_ignore_mask = 0;
			peerConnectionFactory->SetOptions(factoryOptions);
		} catch (...) {
			Shutdown();
			throw;
		}
	}

	~Impl() {
		Shutdown();
	}

	void Shutdown() noexcept {
		peerConnectionFactory = nullptr;
		if (signalingThread) {
			signalingThread->Stop();
		}
		if (workerThread) {
			workerThread->Stop();
		}
		if (networkThread) {
			networkThread->Stop();
		}
		signalingThread.reset();
		workerThread.reset();
		networkThread.reset();
		if (sslAcquired) {
			ReleaseSsl();
			sslAcquired = false;
		}
	}

	webrtc::WinsockInitializer winsock;
	bool sslAcquired = false;
	std::unique_ptr<webrtc::Thread> networkThread;
	std::unique_ptr<webrtc::Thread> workerThread;
	std::unique_ptr<webrtc::Thread> signalingThread;
	webrtc::scoped_refptr<webrtc::PeerConnectionFactoryInterface> peerConnectionFactory;
};

WebRtcRuntime::WebRtcRuntime(ID3D11Device *device, std::string adapterName)
	: WebRtcRuntime(
		  device,
		  std::move(adapterName),
		  ScreenContentMode::Motion) {}

WebRtcRuntime::WebRtcRuntime(
	ID3D11Device *device,
	std::string adapterName,
	const ScreenContentMode contentMode)
	: impl_(std::make_unique<Impl>(
		  device,
		  std::move(adapterName),
		  contentMode)) {}

WebRtcRuntime::~WebRtcRuntime() = default;
WebRtcRuntime::WebRtcRuntime(WebRtcRuntime &&) noexcept = default;
WebRtcRuntime &WebRtcRuntime::operator=(WebRtcRuntime &&) noexcept = default;

webrtc::scoped_refptr<webrtc::PeerConnectionFactoryInterface>
WebRtcRuntime::factory() const {
	if (!impl_) {
		return nullptr;
	}
	return impl_->peerConnectionFactory;
}

webrtc::scoped_refptr<webrtc::VideoTrackInterface>
WebRtcRuntime::CreateVideoTrack(
	NativeVideoSource &source,
	const std::string &label) {
	if (!impl_ || !impl_->peerConnectionFactory || !impl_->signalingThread) {
		return nullptr;
	}
	auto trackSource = source.source();
	return impl_->signalingThread->BlockingCall(
		[this, trackSource = std::move(trackSource), label] {
			return impl_->peerConnectionFactory->CreateVideoTrack(
				trackSource,
				label);
		});
}

} // namespace poio::share
