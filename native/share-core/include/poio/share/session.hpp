#pragma once

#include "poio/share/p2p.hpp"
#include "poio/share/sfu.hpp"

#include <cstdint>
#include <functional>
#include <memory>
#include <string>

namespace poio::share
{
struct NativeShareConfig
{
    std::string sourceId;
    bool captureCursor{ false };
    std::string routerRtpCapabilitiesJson;
    SfuTransportDescription transport;
    SfuPublishOptions publish;
    SfuSignalingCallbacks signaling;
    std::function<void(const std::string& error)> captureError;
};

struct NativeShareStats
{
    std::uint64_t capturedFrames{ 0 };
    std::uint64_t submittedFrames{ 0 };
    std::uint64_t pacedFrames{ 0 };
    std::uint64_t rejectedFrames{ 0 };
    std::uint32_t width{ 0 };
    std::uint32_t height{ 0 };
    std::string sfuStatsJson{ "[]" };
};

// Owns the complete native publisher path:
// WGC -> D3D11 texture -> WebRTC native frame -> MF H.264 -> mediasoup.
class NativeShareSession final
{
public:
    NativeShareSession();
    ~NativeShareSession();

    NativeShareSession(const NativeShareSession&) = delete;
    NativeShareSession& operator=(const NativeShareSession&) = delete;
    NativeShareSession(NativeShareSession&&) = delete;
    NativeShareSession& operator=(NativeShareSession&&) = delete;

    std::string Start(NativeShareConfig config);
    void AddP2pViewer(
        std::string peerId,
        P2pPublishOptions options,
        P2pSignalingCallbacks callbacks);
    void SetP2pRemoteAnswer(
        const std::string& peerId,
        const std::string& sdp);
    void AddP2pRemoteIceCandidate(
        const std::string& peerId,
        const std::string& sdpMid,
        int sdpMLineIndex,
        const std::string& candidate);
    void RemoveP2pViewer(const std::string& peerId) noexcept;
    void SetSfuPaused(bool paused);
    void Stop() noexcept;

    [[nodiscard]] bool running() const noexcept;
    [[nodiscard]] NativeShareStats stats() const noexcept;
    [[nodiscard]] std::string producerId() const;
    [[nodiscard]] std::size_t p2pViewerCount() const noexcept;

private:
    class Impl;
    std::unique_ptr<Impl> impl_;
};
} // namespace poio::share
