#pragma once

#include <chrono>
#include <cstdint>
#include <functional>
#include <memory>
#include <string>

struct ID3D11Device;
struct ID3D11Texture2D;

namespace poio::share {

struct CapturedTextureFrame {
	ID3D11Texture2D *texture = nullptr;
	std::uint32_t width = 0;
	std::uint32_t height = 0;
	std::chrono::steady_clock::time_point capturedAt;
};

using CapturedTextureCallback = std::function<void(const CapturedTextureFrame &)>;
using CaptureErrorCallback = std::function<void(const std::string &)>;

struct CaptureSessionConfig {
	std::string sourceId;
	bool captureCursor = false;
};

class CaptureSession {
public:
	CaptureSession(CaptureSessionConfig config,
				   CapturedTextureCallback onFrame,
				   CaptureErrorCallback onError = {});
	~CaptureSession();

	CaptureSession(const CaptureSession &) = delete;
	CaptureSession &operator=(const CaptureSession &) = delete;
	CaptureSession(CaptureSession &&) = delete;
	CaptureSession &operator=(CaptureSession &&) = delete;

	void Start();
	void Stop() noexcept;
	[[nodiscard]] bool running() const noexcept;
	[[nodiscard]] ID3D11Device *device() const noexcept;
	[[nodiscard]] std::string adapterName() const;
	[[nodiscard]] std::uint32_t width() const noexcept;
	[[nodiscard]] std::uint32_t height() const noexcept;

private:
	struct Impl;
	std::unique_ptr<Impl> impl_;
};

struct CaptureBenchmarkOptions {
	std::string sourceId;
	std::uint32_t targetFrames = 120;
	std::uint32_t timeoutMs = 5000;
	bool captureCursor = false;
};

struct CaptureBenchmarkResult {
	std::string schema = "poio.share.capture-benchmark.v1";
	std::string coreVersion = "0.1.0";
	std::string sourceId;
	bool success = false;
	std::string error;
	std::string adapterName;
	std::string textureFormat;
	std::uint32_t width = 0;
	std::uint32_t height = 0;
	std::uint32_t requestedFrames = 0;
	std::uint32_t capturedFrames = 0;
	std::uint32_t estimatedDroppedFrames = 0;
	double firstFrameLatencyMs = 0.0;
	double measurementDurationMs = 0.0;
	double averageFps = 0.0;
	double averageFrameIntervalMs = 0.0;
	double p95FrameIntervalMs = 0.0;
	double maxFrameIntervalMs = 0.0;
};

[[nodiscard]] CaptureBenchmarkResult RunCaptureBenchmark(const CaptureBenchmarkOptions &options);
[[nodiscard]] std::string SerializeCaptureBenchmark(const CaptureBenchmarkResult &result);

} // namespace poio::share
