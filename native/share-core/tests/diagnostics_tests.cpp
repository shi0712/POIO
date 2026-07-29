#include "poio/share/capture.hpp"
#include "poio/share/diagnostics.hpp"
#include "poio/share/encoder.hpp"
#include "poio/share/h264.hpp"

#include <algorithm>
#include <cstdint>
#include <iostream>
#include <string>

namespace {

int failures = 0;

void Expect(const bool condition, const std::string &message) {
	if (!condition) {
		std::cerr << "FAILED: " << message << '\n';
		++failures;
	}
}

} // namespace

int main() {
	poio::share::ProbeReport report;
	report.osVersion = "Windows \"test\"\nline";
	report.capabilities.windowsGraphicsCapture = true;
	report.capabilities.desktopDuplication = true;
	report.capabilities.mediaFoundation = true;
	report.capabilities.hardwareH264 = true;
	report.adapters.push_back(poio::share::Adapter{
		.id = "adapter:1",
		.name = "GPU",
		.vendor = "NVIDIA",
		.vendorId = 0x10DE,
		.deviceId = 1,
		.dedicatedVideoMemory = 8ULL * 1024ULL * 1024ULL * 1024ULL,
		.software = false,
		.outputCount = 1,
	});
	report.encoders.push_back(poio::share::Encoder{
		.id = "mft:test",
		.name = "H.264",
		.hardwareUrl = "hardware://test",
		.inputFormat = "NV12",
		.outputFormat = "H264",
		.hardware = true,
	});
	report.sources.push_back(poio::share::Source{
		.id = "monitor:test",
		.kind = poio::share::SourceKind::Monitor,
		.name = "Display",
		.application = "Windows",
		.bounds = poio::share::Rect{ .x = -100, .y = 0, .width = 1920, .height = 1080 },
		.primary = true,
		.captureSupported = true,
	});

	const std::string json = poio::share::SerializeReport(report);
	Expect(json.find("\"schema\":\"poio.share.probe.v1\"") != std::string::npos, "schema is serialized");
	Expect(json.find("Windows \\\"test\\\"\\nline") != std::string::npos, "JSON strings are escaped");
	Expect(json.find("\"vendorId\":4318") != std::string::npos, "numeric fields are serialized");
	Expect(json.find("\"width\":1920") != std::string::npos, "source bounds are serialized");
	Expect(json.find("\"hardwareH264\":true") != std::string::npos, "capabilities are serialized");

	const std::string adapters = poio::share::SerializeAdapters(report);
	Expect(adapters.front() == '[' && adapters.back() == ']', "adapter output is a JSON array");

	const std::string captureJson = poio::share::SerializeCaptureBenchmark(poio::share::CaptureBenchmarkResult{
		.sourceId = "monitor:\\\\.\\DISPLAY1",
		.success = true,
		.adapterName = "GPU \"test\"",
		.textureFormat = "B8G8R8A8_UNORM",
		.width = 1920,
		.height = 1080,
		.requestedFrames = 120,
		.capturedFrames = 120,
		.firstFrameLatencyMs = 12.5,
		.averageFps = 60.0,
	});
	Expect(captureJson.find("\"schema\":\"poio.share.capture-benchmark.v1\"") != std::string::npos,
		   "capture benchmark schema is serialized");
	Expect(captureJson.find("\"averageFps\":60.000") != std::string::npos,
		   "capture timing is serialized");
	Expect(captureJson.find("GPU \\\"test\\\"") != std::string::npos,
		   "capture strings are escaped");

	const std::string encodeJson = poio::share::SerializeEncodeBenchmark(poio::share::EncodeBenchmarkResult{
		.sourceId = "monitor:test",
		.success = true,
		.adapterName = "GPU",
		.encoderName = "Hardware H.264",
		.gpuSurfaceInput = true,
		.forceKeyFrameSupported = true,
		.dynamicBitrateSupported = true,
		.bitstreamFormat = "annex-b",
		.contentMode = "detail",
		.spsProfileIdc = 100,
		.spsConstraintFlags = 0,
		.spsLevelIdc = 42,
		.width = 1920,
		.height = 1080,
		.configuredFrameRate = 60,
		.configuredBitrate = 12'000'000,
		.capturedFrames = 200,
		.discardedCaptureFrames = 20,
		.submittedFrames = 180,
		.encodedFrames = 180,
		.spsUnits = 2,
		.ppsUnits = 2,
		.idrUnits = 2,
		.encodedBytes = 3'000'000,
		.averageEncodeLatencyMs = 5.25,
	});
	Expect(encodeJson.find("\"schema\":\"poio.share.encode-benchmark.v1\"") != std::string::npos,
		   "encode benchmark schema is serialized");
	Expect(encodeJson.find("\"gpuSurfaceInput\":true") != std::string::npos,
		   "GPU surface state is serialized");
	Expect(encodeJson.find("\"discardedCaptureFrames\":20") != std::string::npos,
		   "latest-frame queue drops are serialized");
	Expect(encodeJson.find("\"bitstreamFormat\":\"annex-b\"") != std::string::npos,
		   "H.264 bitstream format is serialized");
	Expect(encodeJson.find("\"contentMode\":\"detail\"") != std::string::npos,
		   "screen content mode is serialized");
	Expect(encodeJson.find("\"spsLevelIdc\":42") != std::string::npos,
		   "H.264 SPS level is serialized");
	Expect(encodeJson.find("\"forceKeyFrameSupported\":true") != std::string::npos,
		   "key frame control is serialized");
	Expect(encodeJson.find("\"averageEncodeLatencyMs\":5.250") != std::string::npos,
		   "encode latency is serialized");

	const std::vector<std::uint8_t> smallAccessUnit{
		0, 0, 0, 1, 0x67, 1, 2,
		0, 0, 1, 0x68, 3,
		0, 0, 0, 1, 0x65, 4, 5, 6,
	};
	const auto nalus = poio::share::FindAnnexBNalus(smallAccessUnit);
	Expect(nalus.size() == 3, "Annex-B NAL units are discovered");
	Expect(nalus.size() == 3 && nalus[0].type == 7 && nalus[1].type == 8 && nalus[2].type == 5,
		   "SPS, PPS and IDR NAL types are preserved");

	poio::share::H264RtpPacketizer packetizer(0x12345678, 65534, 10);
	const auto smallPackets = packetizer.Packetize(smallAccessUnit, 90000);
	Expect(smallPackets.size() == 3, "small NAL units use one RTP packet each");
	Expect(!smallPackets[0].marker && !smallPackets[1].marker && smallPackets[2].marker,
		   "only the final packet has the RTP marker bit");
	Expect(smallPackets[0].sequenceNumber == 65534 && smallPackets[1].sequenceNumber == 65535 &&
			   smallPackets[2].sequenceNumber == 0,
		   "RTP sequence numbers wrap correctly");
	const auto serializedPacket = smallPackets.front().Serialize();
	Expect(serializedPacket.size() == 12 + smallPackets.front().payload.size(),
		   "RTP serialization contains a 12-byte header");
	Expect(serializedPacket[0] == 0x80 && (serializedPacket[1] & 0x7FU) == 96,
		   "RTP version and payload type are correct");

	std::vector<std::uint8_t> largeAccessUnit{ 0, 0, 0, 1, 0x65 };
	for (std::uint16_t value = 0; value < 35; ++value) {
		largeAccessUnit.push_back(static_cast<std::uint8_t>(value));
	}
	poio::share::H264RtpPacketizer fragmentingPacketizer(77, 10, 12);
	const auto fragments = fragmentingPacketizer.Packetize(largeAccessUnit, 1234);
	Expect(fragments.size() == 4, "large NAL units are split into FU-A packets");
	Expect(fragments.front().payload.size() >= 2 && (fragments.front().payload[0] & 0x1FU) == 28 &&
			   (fragments.front().payload[1] & 0x80U) != 0,
		   "first FU-A fragment has the start bit");
	Expect(fragments.back().marker && (fragments.back().payload[1] & 0x40U) != 0,
		   "last FU-A fragment has end and marker bits");
	std::vector<std::uint8_t> reconstructed{ 0x65 };
	for (const auto &fragment : fragments) {
		reconstructed.insert(reconstructed.end(), fragment.payload.begin() + 2, fragment.payload.end());
	}
	Expect(std::equal(reconstructed.begin(),
					  reconstructed.end(),
					  largeAccessUnit.begin() + 4,
					  largeAccessUnit.end()),
		   "FU-A fragments reconstruct the original NAL unit");

	if (failures == 0) {
		std::cout << "All POIO share core tests passed\n";
	}
	return failures == 0 ? 0 : 1;
}
