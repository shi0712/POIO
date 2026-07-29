#pragma once

#include <chrono>
#include <cstdint>
#include <functional>
#include <memory>
#include <string>
#include <vector>

struct ID3D11Device;
struct ID3D11Texture2D;

namespace poio::share {

struct EncodedAccessUnit {
	std::vector<std::uint8_t> bytes;
	std::uint64_t frameId = 0;
	std::int64_t captureTimestampUs = 0;
	std::int64_t presentationTimestampUs = 0;
	std::uint32_t rtpTimestamp90Khz = 0;
	std::uint32_t width = 0;
	std::uint32_t height = 0;
	bool keyFrame = false;
	bool containsSps = false;
	bool containsPps = false;
	bool containsIdr = false;
	double encodeLatencyMs = 0.0;
};

using EncodedAccessUnitCallback = std::function<void(EncodedAccessUnit &&)>;

enum class H264Profile {
	ConstrainedBaseline,
	Main,
	High,
};

enum class ScreenContentMode {
	Motion,
	Detail,
};

struct HardwareEncoderConfig {
	std::string adapterName;
	std::uint32_t width = 1920;
	std::uint32_t height = 1080;
	std::uint32_t frameRate = 60;
	std::uint32_t bitrate = 12'000'000;
	std::uint32_t keyFrameInterval = 120;
	H264Profile profile = H264Profile::ConstrainedBaseline;
	ScreenContentMode contentMode = ScreenContentMode::Motion;
};

struct EncodeBenchmarkOptions {
	std::string sourceId;
	std::uint32_t targetFrames = 180;
	std::uint32_t timeoutMs = 10000;
	std::uint32_t frameRate = 60;
	std::uint32_t bitrate = 12'000'000;
	std::uint32_t keyFrameInterval = 120;
	std::uint32_t width = 1920;
	std::uint32_t height = 1080;
	bool captureCursor = false;
	H264Profile profile = H264Profile::High;
	ScreenContentMode contentMode = ScreenContentMode::Motion;
	EncodedAccessUnitCallback onEncodedAccessUnit;
};

struct EncodeBenchmarkResult {
	std::string schema = "poio.share.encode-benchmark.v1";
	std::string coreVersion = "0.1.0";
	std::string sourceId;
	bool success = false;
	std::string error;
	std::string adapterName;
	std::string encoderName;
	std::string inputFormat = "ARGB32";
	std::string outputFormat = "H264";
	bool asynchronous = false;
	bool d3d11Aware = false;
	bool gpuSurfaceInput = false;
	bool lowLatencyEnabled = false;
	bool forceKeyFrameSupported = false;
	bool dynamicBitrateSupported = false;
	std::string bitstreamFormat = "unknown";
	std::string contentMode = "motion";
	std::uint32_t spsProfileIdc = 0;
	std::uint32_t spsConstraintFlags = 0;
	std::uint32_t spsLevelIdc = 0;
	std::uint32_t width = 0;
	std::uint32_t height = 0;
	std::uint32_t configuredFrameRate = 0;
	std::uint32_t configuredBitrate = 0;
	std::uint32_t capturedFrames = 0;
	std::uint32_t discardedCaptureFrames = 0;
	std::uint32_t submittedFrames = 0;
	std::uint32_t encodedFrames = 0;
	std::uint32_t keyFrames = 0;
	std::uint32_t spsUnits = 0;
	std::uint32_t ppsUnits = 0;
	std::uint32_t idrUnits = 0;
	std::uint32_t maxAccessUnitBytes = 0;
	std::uint64_t encodedBytes = 0;
	double firstFrameLatencyMs = 0.0;
	double measurementDurationMs = 0.0;
	double encodeThroughputFps = 0.0;
	double actualBitrateMbps = 0.0;
	double averageEncodeLatencyMs = 0.0;
	double p95EncodeLatencyMs = 0.0;
	double maxEncodeLatencyMs = 0.0;
};

class HardwareEncoderSession {
public:
	HardwareEncoderSession(ID3D11Device *device,
						   HardwareEncoderConfig config,
						   EncodedAccessUnitCallback callback);
	~HardwareEncoderSession();

	HardwareEncoderSession(const HardwareEncoderSession &) = delete;
	HardwareEncoderSession &operator=(const HardwareEncoderSession &) = delete;
	HardwareEncoderSession(HardwareEncoderSession &&) noexcept;
	HardwareEncoderSession &operator=(HardwareEncoderSession &&) noexcept;

	void Encode(ID3D11Texture2D *texture, std::chrono::steady_clock::time_point capturedAt);
	void Encode(ID3D11Texture2D *texture,
				std::chrono::steady_clock::time_point capturedAt,
				std::uint32_t rtpTimestamp90Khz);
	void Pump();
	void Finish();
	[[nodiscard]] bool SetTargetBitrate(std::uint32_t bitrate);
	[[nodiscard]] bool RequestKeyFrame();
	[[nodiscard]] const EncodeBenchmarkResult &stats() const noexcept;

private:
	struct Impl;
	std::unique_ptr<Impl> impl_;
};

[[nodiscard]] EncodeBenchmarkResult RunEncodeBenchmark(const EncodeBenchmarkOptions &options);
[[nodiscard]] std::string SerializeEncodeBenchmark(const EncodeBenchmarkResult &result);

} // namespace poio::share
