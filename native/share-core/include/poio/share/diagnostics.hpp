#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace poio::share {

struct Rect {
	std::int32_t x = 0;
	std::int32_t y = 0;
	std::int32_t width = 0;
	std::int32_t height = 0;
};

struct Capabilities {
	bool windowsGraphicsCapture = false;
	bool desktopDuplication = false;
	bool mediaFoundation = false;
	bool hardwareH264 = false;
};

struct Adapter {
	std::string id;
	std::string name;
	std::string vendor;
	std::uint32_t vendorId = 0;
	std::uint32_t deviceId = 0;
	std::uint64_t dedicatedVideoMemory = 0;
	bool software = false;
	std::uint32_t outputCount = 0;
};

struct Encoder {
	std::string id;
	std::string name;
	std::string hardwareUrl;
	std::string inputFormat;
	std::string outputFormat;
	bool hardware = true;
};

enum class SourceKind {
	Monitor,
	Window,
};

struct Source {
	std::string id;
	SourceKind kind = SourceKind::Monitor;
	std::string name;
	std::string application;
	Rect bounds;
	bool primary = false;
	bool captureSupported = true;
};

struct ProbeReport {
	std::string schema = "poio.share.probe.v1";
	std::string coreVersion = "0.1.0";
	std::string platform = "windows";
	std::string osVersion;
	Capabilities capabilities;
	std::vector<Adapter> adapters;
	std::vector<Encoder> encoders;
	std::vector<Source> sources;
	std::vector<std::string> warnings;
};

[[nodiscard]] ProbeReport ProbeSystem();
[[nodiscard]] std::string SerializeReport(const ProbeReport &report);
[[nodiscard]] std::string SerializeAdapters(const ProbeReport &report);
[[nodiscard]] std::string SerializeEncoders(const ProbeReport &report);
[[nodiscard]] std::string SerializeSources(const ProbeReport &report);

} // namespace poio::share

