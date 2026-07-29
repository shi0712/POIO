#include "poio/share/capture.hpp"
#include "poio/share/diagnostics.hpp"
#include "poio/share/encoder.hpp"
#include "poio/share/h264.hpp"

#include <Windows.h>

#include <fcntl.h>
#include <io.h>

#include <iostream>
#include <limits>
#include <string>

namespace {

void PrintUsage() {
	std::cerr << "POIO Share Lab 0.1.0\n"
			  << "Usage:\n"
			  << "  poio-share-lab <probe|adapters|encoders|sources> [--json]\n"
			  << "  poio-share-lab benchmark <source-id> [--frames N] [--timeout-ms N] [--cursor]\n"
			  << "  poio-share-lab encode-benchmark <source-id> [--frames N] [--fps N]\n"
			  << "                                      [--bitrate-mbps N] [--timeout-ms N]\n"
			  << "                                      [--width N] [--height N]\n"
			  << "                                      [--profile baseline|main|high]\n"
			  << "                                      [--content-mode motion|detail]\n"
			  << "  source-id may be synthetic:motion for a GPU-only high-motion stress test\n";
}

bool ParseUnsigned(const std::string &text, std::uint32_t &value) {
	try {
		std::size_t parsed = 0;
		const unsigned long parsedValue = std::stoul(text, &parsed, 10);
		if (parsed != text.size() || parsedValue > std::numeric_limits<std::uint32_t>::max()) {
			return false;
		}
		value = static_cast<std::uint32_t>(parsedValue);
		return true;
	} catch (...) {
		return false;
	}
}

} // namespace

int main(const int argc, char **argv) {
	if (argc < 2) {
		PrintUsage();
		return 2;
	}
	_setmode(_fileno(stdout), _O_BINARY);

	const std::string command = argv[1];

	if (command == "encode-benchmark") {
		if (argc < 3) {
			PrintUsage();
			return 2;
		}
		poio::share::EncodeBenchmarkOptions options;
		options.sourceId = argv[2];
		std::uint32_t deliveredAccessUnits = 0;
		std::uint32_t deliveredKeyFrames = 0;
		bool validAccessUnits = true;
		std::uint8_t observedSpsProfileIdc = 0;
		std::uint64_t previousFrameId = 0;
		std::int64_t previousPresentationTimestampUs = -1;
		options.onEncodedAccessUnit =
			[&](poio::share::EncodedAccessUnit &&accessUnit) {
				if (accessUnit.bytes.empty() || accessUnit.width == 0 || accessUnit.height == 0 ||
					(deliveredAccessUnits != 0 && accessUnit.frameId != previousFrameId + 1) ||
					accessUnit.presentationTimestampUs <= previousPresentationTimestampUs) {
					validAccessUnits = false;
				}
				if (accessUnit.containsSps && observedSpsProfileIdc == 0) {
					for (const auto &nalu : poio::share::FindAnnexBNalus(accessUnit.bytes)) {
						if (nalu.type == 7 && nalu.size >= 2) {
							observedSpsProfileIdc = accessUnit.bytes[nalu.offset + 1];
							break;
						}
					}
				}
				previousFrameId = accessUnit.frameId;
				previousPresentationTimestampUs = accessUnit.presentationTimestampUs;
				++deliveredAccessUnits;
				if (accessUnit.keyFrame) {
					++deliveredKeyFrames;
				}
			};
		for (int index = 3; index < argc; ++index) {
			const std::string argument = argv[index];
			if (argument == "--cursor") {
				options.captureCursor = true;
				continue;
			}
			if (argument == "--profile" && index + 1 < argc) {
				const std::string profile = argv[++index];
				if (profile == "baseline") {
					options.profile = poio::share::H264Profile::ConstrainedBaseline;
				} else if (profile == "main") {
					options.profile = poio::share::H264Profile::Main;
				} else if (profile == "high") {
					options.profile = poio::share::H264Profile::High;
				} else {
					std::cerr << "Invalid H.264 profile: " << profile << '\n';
					return 2;
				}
				continue;
			}
			if (argument == "--content-mode" && index + 1 < argc) {
				const std::string mode = argv[++index];
				if (mode == "motion") {
					options.contentMode = poio::share::ScreenContentMode::Motion;
				} else if (mode == "detail") {
					options.contentMode = poio::share::ScreenContentMode::Detail;
				} else {
					std::cerr << "Invalid screen content mode: " << mode << '\n';
					return 2;
				}
				continue;
			}
			if ((argument == "--frames" || argument == "--timeout-ms" || argument == "--fps" ||
				 argument == "--bitrate-mbps" || argument == "--width" || argument == "--height") &&
				index + 1 < argc) {
				std::uint32_t value = 0;
				if (!ParseUnsigned(argv[++index], value)) {
					std::cerr << "Invalid numeric option value\n";
					return 2;
				}
				if (argument == "--frames") {
					options.targetFrames = value;
				} else if (argument == "--timeout-ms") {
					options.timeoutMs = value;
				} else if (argument == "--fps") {
					options.frameRate = value;
				} else if (argument == "--width") {
					options.width = value;
				} else if (argument == "--height") {
					options.height = value;
				} else {
					if (value > std::numeric_limits<std::uint32_t>::max() / 1'000'000U) {
						std::cerr << "Bitrate is too large\n";
						return 2;
					}
					options.bitrate = value * 1'000'000U;
				}
				continue;
			}
			std::cerr << "Unknown encode benchmark option: " << argument << '\n';
			return 2;
		}
		auto result = poio::share::RunEncodeBenchmark(options);
		const std::uint8_t expectedSpsProfileIdc =
			options.profile == poio::share::H264Profile::ConstrainedBaseline
			? 66
			: options.profile == poio::share::H264Profile::Main ? 77 : 100;
		if (result.success &&
			(!validAccessUnits || deliveredAccessUnits != result.encodedFrames ||
			 deliveredKeyFrames != result.keyFrames ||
			 observedSpsProfileIdc != expectedSpsProfileIdc)) {
			result.success = false;
			result.error = "Encoded access-unit callback or H.264 profile validation failed";
		}
		std::cout << poio::share::SerializeEncodeBenchmark(result) << '\n';
		return result.success ? 0 : 1;
	}

	if (command == "benchmark") {
		if (argc < 3) {
			PrintUsage();
			return 2;
		}
		poio::share::CaptureBenchmarkOptions options;
		options.sourceId = argv[2];
		for (int index = 3; index < argc; ++index) {
			const std::string argument = argv[index];
			if (argument == "--cursor") {
				options.captureCursor = true;
				continue;
			}
			if ((argument == "--frames" || argument == "--timeout-ms") && index + 1 < argc) {
				std::uint32_t value = 0;
				if (!ParseUnsigned(argv[++index], value)) {
					std::cerr << "Invalid numeric option value\n";
					return 2;
				}
				if (argument == "--frames") {
					options.targetFrames = value;
				} else {
					options.timeoutMs = value;
				}
				continue;
			}
			std::cerr << "Unknown benchmark option: " << argument << '\n';
			return 2;
		}
		const auto result = poio::share::RunCaptureBenchmark(options);
		std::cout << poio::share::SerializeCaptureBenchmark(result) << '\n';
		return result.success ? 0 : 1;
	}

	const poio::share::ProbeReport report = poio::share::ProbeSystem();

	if (command == "probe") {
		std::cout << poio::share::SerializeReport(report) << '\n';
		return 0;
	}
	if (command == "adapters") {
		std::cout << poio::share::SerializeAdapters(report) << '\n';
		return 0;
	}
	if (command == "encoders") {
		std::cout << poio::share::SerializeEncoders(report) << '\n';
		return 0;
	}
	if (command == "sources") {
		std::cout << poio::share::SerializeSources(report) << '\n';
		return 0;
	}

	PrintUsage();
	return 2;
}
