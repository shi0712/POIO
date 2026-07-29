#include "poio/share/h264.hpp"

#include <algorithm>
#include <stdexcept>

namespace poio::share {
namespace {

struct StartCode {
	std::size_t offset = 0;
	std::size_t length = 0;
};

StartCode FindStartCode(const std::span<const std::uint8_t> bytes, const std::size_t begin) {
	for (std::size_t offset = begin; offset + 3 <= bytes.size(); ++offset) {
		if (bytes[offset] != 0 || bytes[offset + 1] != 0) {
			continue;
		}
		if (bytes[offset + 2] == 1) {
			return StartCode{ .offset = offset, .length = 3 };
		}
		if (offset + 4 <= bytes.size() && bytes[offset + 2] == 0 && bytes[offset + 3] == 1) {
			return StartCode{ .offset = offset, .length = 4 };
		}
	}
	return StartCode{ .offset = bytes.size(), .length = 0 };
}

} // namespace

std::vector<std::uint8_t> RtpPacket::Serialize() const {
	std::vector<std::uint8_t> bytes(12 + payload.size());
	bytes[0] = 0x80;
	bytes[1] = static_cast<std::uint8_t>((marker ? 0x80U : 0U) | 96U);
	bytes[2] = static_cast<std::uint8_t>(sequenceNumber >> 8U);
	bytes[3] = static_cast<std::uint8_t>(sequenceNumber);
	bytes[4] = static_cast<std::uint8_t>(timestamp >> 24U);
	bytes[5] = static_cast<std::uint8_t>(timestamp >> 16U);
	bytes[6] = static_cast<std::uint8_t>(timestamp >> 8U);
	bytes[7] = static_cast<std::uint8_t>(timestamp);
	bytes[8] = static_cast<std::uint8_t>(ssrc >> 24U);
	bytes[9] = static_cast<std::uint8_t>(ssrc >> 16U);
	bytes[10] = static_cast<std::uint8_t>(ssrc >> 8U);
	bytes[11] = static_cast<std::uint8_t>(ssrc);
	std::copy(payload.begin(), payload.end(), bytes.begin() + 12);
	return bytes;
}

std::vector<H264Nalu> FindAnnexBNalus(const std::span<const std::uint8_t> accessUnit) {
	std::vector<H264Nalu> nalus;
	StartCode current = FindStartCode(accessUnit, 0);
	while (current.length != 0) {
		const std::size_t naluStart = current.offset + current.length;
		const StartCode next = FindStartCode(accessUnit, naluStart);
		std::size_t naluEnd = next.offset;
		while (naluEnd > naluStart && accessUnit[naluEnd - 1] == 0) {
			--naluEnd;
		}
		if (naluEnd > naluStart) {
			nalus.push_back(H264Nalu{
				.offset = naluStart,
				.size = naluEnd - naluStart,
				.type = static_cast<std::uint8_t>(accessUnit[naluStart] & 0x1FU),
			});
		}
		current = next;
	}
	return nalus;
}

H264RtpPacketizer::H264RtpPacketizer(const std::uint32_t ssrc,
									 const std::uint16_t initialSequenceNumber,
									 const std::size_t maximumPayloadBytes)
	: ssrc_(ssrc),
	  nextSequenceNumber_(initialSequenceNumber),
	  maximumPayloadBytes_(maximumPayloadBytes) {
	if (maximumPayloadBytes_ < 3 || maximumPayloadBytes_ > 65523) {
		throw std::invalid_argument("H.264 RTP maximum payload must be between 3 and 65523 bytes");
	}
}

RtpPacket H264RtpPacketizer::MakePacket(const std::uint32_t timestamp, const bool marker) {
	return RtpPacket{
		.sequenceNumber = nextSequenceNumber_++,
		.timestamp = timestamp,
		.ssrc = ssrc_,
		.marker = marker,
	};
}

std::vector<RtpPacket> H264RtpPacketizer::Packetize(
	const std::span<const std::uint8_t> annexBAccessUnit,
	const std::uint32_t timestamp) {
	const std::vector<H264Nalu> nalus = FindAnnexBNalus(annexBAccessUnit);
	if (nalus.empty()) {
		throw std::invalid_argument("H.264 access unit is not Annex-B");
	}

	std::vector<RtpPacket> packets;
	for (std::size_t naluIndex = 0; naluIndex < nalus.size(); ++naluIndex) {
		const H264Nalu &nalu = nalus[naluIndex];
		const auto bytes = annexBAccessUnit.subspan(nalu.offset, nalu.size);
		const bool lastNalu = naluIndex + 1 == nalus.size();
		if (bytes.size() <= maximumPayloadBytes_) {
			RtpPacket packet = MakePacket(timestamp, lastNalu);
			packet.payload.assign(bytes.begin(), bytes.end());
			packets.push_back(std::move(packet));
			continue;
		}

		const std::uint8_t naluHeader = bytes.front();
		const std::uint8_t fuIndicator = static_cast<std::uint8_t>((naluHeader & 0xE0U) | 28U);
		const std::uint8_t naluType = static_cast<std::uint8_t>(naluHeader & 0x1FU);
		const std::size_t fragmentCapacity = maximumPayloadBytes_ - 2;
		std::size_t offset = 1;
		bool firstFragment = true;
		while (offset < bytes.size()) {
			const std::size_t fragmentSize = std::min(fragmentCapacity, bytes.size() - offset);
			const bool lastFragment = offset + fragmentSize == bytes.size();
			RtpPacket packet = MakePacket(timestamp, lastNalu && lastFragment);
			packet.payload.reserve(fragmentSize + 2);
			packet.payload.push_back(fuIndicator);
			packet.payload.push_back(static_cast<std::uint8_t>(
				(firstFragment ? 0x80U : 0U) | (lastFragment ? 0x40U : 0U) | naluType));
			packet.payload.insert(
				packet.payload.end(), bytes.begin() + static_cast<std::ptrdiff_t>(offset),
				bytes.begin() + static_cast<std::ptrdiff_t>(offset + fragmentSize));
			packets.push_back(std::move(packet));
			offset += fragmentSize;
			firstFragment = false;
		}
	}
	return packets;
}

std::uint16_t H264RtpPacketizer::nextSequenceNumber() const noexcept {
	return nextSequenceNumber_;
}

} // namespace poio::share

