#pragma once

#include <cstddef>
#include <cstdint>
#include <span>
#include <vector>

namespace poio::share {

struct H264Nalu {
	std::size_t offset = 0;
	std::size_t size = 0;
	std::uint8_t type = 0;
};

struct RtpPacket {
	std::uint16_t sequenceNumber = 0;
	std::uint32_t timestamp = 0;
	std::uint32_t ssrc = 0;
	bool marker = false;
	std::vector<std::uint8_t> payload;

	[[nodiscard]] std::vector<std::uint8_t> Serialize() const;
};

[[nodiscard]] std::vector<H264Nalu> FindAnnexBNalus(std::span<const std::uint8_t> accessUnit);

class H264RtpPacketizer {
public:
	explicit H264RtpPacketizer(std::uint32_t ssrc,
							  std::uint16_t initialSequenceNumber = 0,
							  std::size_t maximumPayloadBytes = 1200);

	[[nodiscard]] std::vector<RtpPacket> Packetize(std::span<const std::uint8_t> annexBAccessUnit,
												  std::uint32_t timestamp);
	[[nodiscard]] std::uint16_t nextSequenceNumber() const noexcept;

private:
	RtpPacket MakePacket(std::uint32_t timestamp, bool marker);

	std::uint32_t ssrc_ = 0;
	std::uint16_t nextSequenceNumber_ = 0;
	std::size_t maximumPayloadBytes_ = 1200;
};

} // namespace poio::share

