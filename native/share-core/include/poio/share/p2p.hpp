#pragma once

#include <cstdint>
#include <functional>
#include <memory>
#include <string>
#include <vector>

#include "api/media_stream_interface.h"
#include "api/peer_connection_interface.h"
#include "api/scoped_refptr.h"

namespace poio::share
{
struct P2pIceServer
{
    std::vector<std::string> urls;
    std::string username;
    std::string credential;
};

enum class P2pDegradationPreference
{
    Balanced,
    PreserveResolution,
    PreserveFrameRate,
};

enum class P2pConnectionState
{
    New,
    Connecting,
    Connected,
    Disconnected,
    Failed,
    Closed,
};

enum class P2pRoute
{
    Unknown,
    Direct,
    Turn,
};

struct P2pPublishOptions
{
    std::vector<P2pIceServer> iceServers;
    std::uint32_t minBitrateBps{ 800'000 };
    std::uint32_t startBitrateBps{ 4'000'000 };
    std::uint32_t maxBitrateBps{ 20'000'000 };
    double maxFrameRate{ 60.0 };
    std::size_t maximumPeers{ 2 };
    int iceCandidatePoolSize{ 4 };
    bool forceTurn{ false };
    P2pDegradationPreference degradationPreference{
        P2pDegradationPreference::PreserveResolution
    };
};

struct P2pSignalingCallbacks
{
    // Callbacks run on WebRTC's signaling/network threads. Integrations must
    // enqueue them rather than calling Electron IPC synchronously.
    std::function<void(
        const std::string& peerId,
        const std::string& type,
        const std::string& sdp)> localDescription;
    std::function<void(
        const std::string& peerId,
        const std::string& sdpMid,
        int sdpMLineIndex,
        const std::string& candidate)> localCandidate;
    std::function<void(
        const std::string& peerId,
        P2pConnectionState state,
        P2pRoute route)> connectionStateChanged;
    std::function<void(
        const std::string& peerId,
        const std::string& error)> error;
};

// Creates one send-only PeerConnection per viewer while sharing the same
// D3D11-backed VideoTrack. ICE first attempts a direct route and transparently
// uses the configured TURN server when direct NAT traversal is unavailable.
class P2pPublisher final
{
public:
    explicit P2pPublisher(
        webrtc::scoped_refptr<webrtc::PeerConnectionFactoryInterface> factory);
    ~P2pPublisher();

    P2pPublisher(const P2pPublisher&) = delete;
    P2pPublisher& operator=(const P2pPublisher&) = delete;
    P2pPublisher(P2pPublisher&&) noexcept;
    P2pPublisher& operator=(P2pPublisher&&) noexcept;

    void AddViewer(
        std::string peerId,
        webrtc::scoped_refptr<webrtc::VideoTrackInterface> track,
        P2pPublishOptions options,
        P2pSignalingCallbacks callbacks);
    void SetRemoteAnswer(const std::string& peerId, const std::string& sdp);
    void AddRemoteIceCandidate(
        const std::string& peerId,
        const std::string& sdpMid,
        int sdpMLineIndex,
        const std::string& candidate);
    void RemoveViewer(const std::string& peerId) noexcept;
    void Close() noexcept;

    [[nodiscard]] bool HasViewer(const std::string& peerId) const noexcept;
    [[nodiscard]] std::size_t ViewerCount() const noexcept;

private:
    class Impl;
    std::unique_ptr<Impl> impl_;
};
} // namespace poio::share
