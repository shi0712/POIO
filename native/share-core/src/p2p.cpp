#include "poio/share/p2p.hpp"

#include <api/jsep.h>
#include <api/make_ref_counted.h>
#include <api/priority.h>
#include <api/rtp_parameters.h>
#include <api/rtp_transceiver_interface.h>
#include <api/set_remote_description_observer_interface.h>
#include <api/transport/bitrate_settings.h>
#include <p2p/base/candidate_pair_interface.h>
#include <p2p/base/port.h>

#include <algorithm>
#include <atomic>
#include <limits>
#include <map>
#include <mutex>
#include <optional>
#include <stdexcept>
#include <utility>
#include <vector>

namespace poio::share
{
namespace
{
struct PendingCandidate
{
    std::string sdpMid;
    int sdpMLineIndex{ 0 };
    std::string candidate;
};

struct Peer;

template<typename Callback, typename... Args>
void InvokeNoThrow(const Callback& callback, Args&&... args) noexcept
{
    if (!callback)
    {
        return;
    }
    try
    {
        callback(std::forward<Args>(args)...);
    }
    catch (...)
    {
        // Never allow an application callback to unwind through WebRTC.
    }
}

P2pConnectionState ToPublicState(
    const webrtc::PeerConnectionInterface::PeerConnectionState state)
{
    using State = webrtc::PeerConnectionInterface::PeerConnectionState;
    switch (state)
    {
        case State::kNew:
            return P2pConnectionState::New;
        case State::kConnecting:
            return P2pConnectionState::Connecting;
        case State::kConnected:
            return P2pConnectionState::Connected;
        case State::kDisconnected:
            return P2pConnectionState::Disconnected;
        case State::kFailed:
            return P2pConnectionState::Failed;
        case State::kClosed:
            return P2pConnectionState::Closed;
    }
    return P2pConnectionState::Failed;
}

webrtc::DegradationPreference ToWebRtcPreference(
    const P2pDegradationPreference preference)
{
    switch (preference)
    {
        case P2pDegradationPreference::PreserveResolution:
            return webrtc::DegradationPreference::MAINTAIN_RESOLUTION;
        case P2pDegradationPreference::PreserveFrameRate:
            return webrtc::DegradationPreference::MAINTAIN_FRAMERATE;
        case P2pDegradationPreference::Balanced:
            return webrtc::DegradationPreference::BALANCED;
    }
    return webrtc::DegradationPreference::BALANCED;
}

void ReportError(const std::shared_ptr<Peer>& peer, std::string error) noexcept;
void AddCandidateNow(
    const std::shared_ptr<Peer>& peer,
    PendingCandidate candidate) noexcept;

struct Peer
{
    std::string id;
    P2pSignalingCallbacks callbacks;
    webrtc::scoped_refptr<webrtc::PeerConnectionInterface> connection;
    std::unique_ptr<webrtc::PeerConnectionObserver> observer;
    mutable std::mutex mutex;
    std::vector<PendingCandidate> pendingRemoteCandidates;
    std::vector<PendingCandidate> pendingLocalCandidates;
    bool remoteDescriptionSet{ false };
    bool localDescriptionPublished{ false };
    std::atomic_bool closed{ false };
    std::atomic<P2pRoute> route{ P2pRoute::Unknown };

    void PublishLocalDescription(std::string sdp) noexcept
    {
        std::vector<PendingCandidate> candidates;
        {
            std::lock_guard lock(mutex);
            if (closed.load(std::memory_order_acquire))
            {
                return;
            }
            localDescriptionPublished = true;
            candidates = std::move(pendingLocalCandidates);
            pendingLocalCandidates.clear();
        }
        InvokeNoThrow(callbacks.localDescription, id, "offer", sdp);
        for (const auto& candidate : candidates)
        {
            InvokeNoThrow(
                callbacks.localCandidate,
                id,
                candidate.sdpMid,
                candidate.sdpMLineIndex,
                candidate.candidate);
        }
    }

    void PublishLocalCandidate(PendingCandidate candidate) noexcept
    {
        {
            std::lock_guard lock(mutex);
            if (closed.load(std::memory_order_acquire))
            {
                return;
            }
            if (!localDescriptionPublished)
            {
                if (pendingLocalCandidates.size() < 64)
                {
                    pendingLocalCandidates.push_back(std::move(candidate));
                }
                return;
            }
        }
        InvokeNoThrow(
            callbacks.localCandidate,
            id,
            candidate.sdpMid,
            candidate.sdpMLineIndex,
            candidate.candidate);
    }
};

void ReportError(const std::shared_ptr<Peer>& peer, std::string error) noexcept
{
    if (!peer || peer->closed.load(std::memory_order_acquire))
    {
        return;
    }
    InvokeNoThrow(peer->callbacks.error, peer->id, error);
}

class PeerObserver final : public webrtc::PeerConnectionObserver
{
public:
    explicit PeerObserver(std::weak_ptr<Peer> peer)
        : peer_(std::move(peer))
    {
    }

    void OnSignalingChange(
        webrtc::PeerConnectionInterface::SignalingState) override
    {
    }

    void OnDataChannel(
        webrtc::scoped_refptr<webrtc::DataChannelInterface>) override
    {
    }

    void OnIceGatheringChange(
        webrtc::PeerConnectionInterface::IceGatheringState) override
    {
    }

    void OnIceCandidate(const webrtc::IceCandidate* candidate) override
    {
        const auto peer = peer_.lock();
        if (!peer || candidate == nullptr)
        {
            return;
        }
        peer->PublishLocalCandidate({
            .sdpMid = candidate->sdp_mid(),
            .sdpMLineIndex = candidate->sdp_mline_index(),
            .candidate = candidate->ToString(),
        });
    }

    void OnConnectionChange(
        const webrtc::PeerConnectionInterface::PeerConnectionState state) override
    {
        const auto peer = peer_.lock();
        if (!peer || peer->closed.load(std::memory_order_acquire))
        {
            return;
        }
        InvokeNoThrow(
            peer->callbacks.connectionStateChanged,
            peer->id,
            ToPublicState(state),
            peer->route.load(std::memory_order_acquire));
    }

    void OnIceSelectedCandidatePairChanged(
        const webrtc::CandidatePairChangeEvent& event) override
    {
        const auto peer = peer_.lock();
        if (!peer || peer->closed.load(std::memory_order_acquire))
        {
            return;
        }
        const auto& local = event.selected_candidate_pair.local_candidate();
        const auto& remote = event.selected_candidate_pair.remote_candidate();
        const P2pRoute route =
            local.is_relay() || remote.is_relay()
                ? P2pRoute::Turn
                : P2pRoute::Direct;
        peer->route.store(route, std::memory_order_release);
        const auto state = peer->connection
            ? ToPublicState(peer->connection->peer_connection_state())
            : P2pConnectionState::Closed;
        InvokeNoThrow(
            peer->callbacks.connectionStateChanged,
            peer->id,
            state,
            route);
    }

private:
    std::weak_ptr<Peer> peer_;
};

class SetLocalObserver
    : public webrtc::SetLocalDescriptionObserverInterface
{
public:
    SetLocalObserver(std::weak_ptr<Peer> peer, std::string sdp)
        : peer_(std::move(peer)),
          sdp_(std::move(sdp))
    {
    }

    void OnSetLocalDescriptionComplete(webrtc::RTCError error) override
    {
        const auto peer = peer_.lock();
        if (!peer)
        {
            return;
        }
        if (!error.ok())
        {
            ReportError(
                peer,
                "Setting the native P2P local offer failed: " +
                    std::string(error.message()));
            return;
        }
        peer->PublishLocalDescription(std::move(sdp_));
    }

private:
    std::weak_ptr<Peer> peer_;
    std::string sdp_;
};

class CreateOfferObserver
    : public webrtc::CreateSessionDescriptionObserver
{
public:
    explicit CreateOfferObserver(std::weak_ptr<Peer> peer)
        : peer_(std::move(peer))
    {
    }

    void OnSuccess(webrtc::SessionDescriptionInterface* description) override
    {
        std::unique_ptr<webrtc::SessionDescriptionInterface> owned(description);
        const auto peer = peer_.lock();
        if (!peer || peer->closed.load(std::memory_order_acquire) || !owned)
        {
            return;
        }
        std::string sdp;
        if (!owned->ToString(&sdp))
        {
            ReportError(peer, "Serializing the native P2P offer failed.");
            return;
        }
        peer->connection->SetLocalDescription(
            std::move(owned),
            webrtc::make_ref_counted<SetLocalObserver>(peer, std::move(sdp)));
    }

    void OnFailure(webrtc::RTCError error) override
    {
        const auto peer = peer_.lock();
        if (peer)
        {
            ReportError(
                peer,
                "Creating the native P2P offer failed: " +
                    std::string(error.message()));
        }
    }

private:
    std::weak_ptr<Peer> peer_;
};

class SetRemoteObserver
    : public webrtc::SetRemoteDescriptionObserverInterface
{
public:
    explicit SetRemoteObserver(std::weak_ptr<Peer> peer)
        : peer_(std::move(peer))
    {
    }

    void OnSetRemoteDescriptionComplete(webrtc::RTCError error) override
    {
        const auto peer = peer_.lock();
        if (!peer)
        {
            return;
        }
        if (!error.ok())
        {
            ReportError(
                peer,
                "Setting the native P2P answer failed: " +
                    std::string(error.message()));
            return;
        }

        std::vector<PendingCandidate> candidates;
        {
            std::lock_guard lock(peer->mutex);
            peer->remoteDescriptionSet = true;
            candidates = std::move(peer->pendingRemoteCandidates);
            peer->pendingRemoteCandidates.clear();
        }
        for (auto& candidate : candidates)
        {
            AddCandidateNow(peer, std::move(candidate));
        }
    }

private:
    std::weak_ptr<Peer> peer_;
};

void AddCandidateNow(
    const std::shared_ptr<Peer>& peer,
    PendingCandidate candidate) noexcept
{
    webrtc::SdpParseError parseError;
    auto parsed = webrtc::IceCandidate::Create(
        candidate.sdpMid,
        candidate.sdpMLineIndex,
        candidate.candidate,
        &parseError);
    if (!parsed)
    {
        ReportError(
            peer,
            "Parsing a native P2P ICE candidate failed: " +
                parseError.description);
        return;
    }
    peer->connection->AddIceCandidate(
        std::move(parsed),
        [weakPeer = std::weak_ptr<Peer>(peer)](webrtc::RTCError error)
        {
            const auto locked = weakPeer.lock();
            if (locked && !error.ok())
            {
                ReportError(
                    locked,
                    "Adding a native P2P ICE candidate failed: " +
                        std::string(error.message()));
            }
        });
}

std::vector<webrtc::RtpCodecCapability> PreferredVideoCodecs(
    webrtc::PeerConnectionFactoryInterface* factory)
{
    auto codecs =
        factory->GetRtpSenderCapabilities(webrtc::MediaType::VIDEO).codecs;
    std::stable_sort(
        codecs.begin(),
        codecs.end(),
        [](const auto& left, const auto& right)
        {
            const bool leftH264 = left.name == "H264";
            const bool rightH264 = right.name == "H264";
            return leftH264 && !rightH264;
        });
    return codecs;
}
} // namespace

class P2pPublisher::Impl
{
public:
    explicit Impl(
        webrtc::scoped_refptr<webrtc::PeerConnectionFactoryInterface> factory)
        : factory_(std::move(factory))
    {
        if (!factory_)
        {
            throw std::invalid_argument(
                "The WebRTC peer connection factory is required.");
        }
    }

    ~Impl()
    {
        Close();
    }

    void AddViewer(
        std::string peerId,
        webrtc::scoped_refptr<webrtc::VideoTrackInterface> track,
        P2pPublishOptions options,
        P2pSignalingCallbacks callbacks)
    {
        if (peerId.empty())
        {
            throw std::invalid_argument("The P2P viewer id is required.");
        }
        if (!track)
        {
            throw std::invalid_argument("The native screen video track is required.");
        }
        if (!callbacks.localDescription || !callbacks.localCandidate)
        {
            throw std::invalid_argument(
                "The P2P signaling callbacks are required.");
        }
        if (options.maximumPeers == 0 ||
            options.minBitrateBps == 0 ||
            options.startBitrateBps == 0 ||
            options.maxBitrateBps == 0 ||
            options.minBitrateBps > options.startBitrateBps ||
            options.startBitrateBps > options.maxBitrateBps ||
            options.maxFrameRate <= 0.0 ||
            options.iceCandidatePoolSize < 0 ||
            options.iceCandidatePoolSize > 255)
        {
            throw std::invalid_argument("The P2P publish options are invalid.");
        }

        {
            std::lock_guard lock(mutex_);
            if (peers_.contains(peerId))
            {
                throw std::logic_error("The P2P viewer already exists.");
            }
            if (peers_.size() >= options.maximumPeers)
            {
                throw std::runtime_error(
                    "The native P2P viewer limit has been reached.");
            }
        }

        auto peer = std::make_shared<Peer>();
        peer->id = std::move(peerId);
        peer->callbacks = std::move(callbacks);
        peer->observer = std::make_unique<PeerObserver>(peer);

        webrtc::PeerConnectionInterface::RTCConfiguration configuration;
        configuration.sdp_semantics = webrtc::SdpSemantics::kUnifiedPlan;
        configuration.bundle_policy =
            webrtc::PeerConnectionInterface::kBundlePolicyMaxBundle;
        configuration.rtcp_mux_policy =
            webrtc::PeerConnectionInterface::kRtcpMuxPolicyRequire;
        configuration.ice_candidate_pool_size = options.iceCandidatePoolSize;
        configuration.type = options.forceTurn
            ? webrtc::PeerConnectionInterface::kRelay
            : webrtc::PeerConnectionInterface::kAll;
        configuration.continual_gathering_policy =
            webrtc::PeerConnectionInterface::GATHER_CONTINUALLY;
        configuration.screencast_min_bitrate = static_cast<int>(
            std::min<std::uint32_t>(
                std::max<std::uint32_t>(1, options.minBitrateBps / 1'000),
                static_cast<std::uint32_t>(std::numeric_limits<int>::max())));

        for (const auto& configured : options.iceServers)
        {
            if (configured.urls.empty())
            {
                continue;
            }
            webrtc::PeerConnectionInterface::IceServer server;
            server.urls = configured.urls;
            server.username = configured.username;
            server.password = configured.credential;
            configuration.servers.push_back(std::move(server));
        }

        auto connectionOrError = factory_->CreatePeerConnectionOrError(
            configuration,
            webrtc::PeerConnectionDependencies(peer->observer.get()));
        if (!connectionOrError.ok())
        {
            throw std::runtime_error(
                "Creating the native P2P connection failed: " +
                std::string(connectionOrError.error().message()));
        }
        peer->connection = connectionOrError.MoveValue();

        webrtc::RtpEncodingParameters encoding;
        encoding.active = true;
        encoding.bitrate_priority = 4.0;
        encoding.network_priority = webrtc::Priority::kHigh;
        encoding.min_bitrate_bps = static_cast<int>(
            std::min<std::uint32_t>(
                options.minBitrateBps,
                static_cast<std::uint32_t>(std::numeric_limits<int>::max())));
        encoding.max_bitrate_bps = static_cast<int>(
            std::min<std::uint32_t>(
                options.maxBitrateBps,
                static_cast<std::uint32_t>(std::numeric_limits<int>::max())));
        encoding.max_framerate = options.maxFrameRate;

        webrtc::RtpTransceiverInit transceiverOptions;
        transceiverOptions.direction =
            webrtc::RtpTransceiverDirection::kSendOnly;
        transceiverOptions.stream_ids = { "poio-native-screen" };
        transceiverOptions.send_encodings = { encoding };
        auto transceiverOrError =
            peer->connection->AddTransceiver(track, transceiverOptions);
        if (!transceiverOrError.ok())
        {
            peer->connection->Close();
            throw std::runtime_error(
                "Adding the native P2P video transceiver failed: " +
                std::string(transceiverOrError.error().message()));
        }
        auto transceiver = transceiverOrError.MoveValue();

        auto codecs = PreferredVideoCodecs(factory_.get());
        const auto codecResult = transceiver->SetCodecPreferences(codecs);
        if (!codecResult.ok())
        {
            peer->connection->Close();
            throw std::runtime_error(
                "Selecting native H.264 for P2P failed: " +
                std::string(codecResult.message()));
        }

        auto senderParameters = transceiver->sender()->GetParameters();
        if (senderParameters.encodings.empty())
        {
            senderParameters.encodings.push_back(encoding);
        }
        else
        {
            senderParameters.encodings.front().active = true;
            senderParameters.encodings.front().bitrate_priority = 4.0;
            senderParameters.encodings.front().network_priority =
                webrtc::Priority::kHigh;
            senderParameters.encodings.front().min_bitrate_bps =
                encoding.min_bitrate_bps;
            senderParameters.encodings.front().max_bitrate_bps =
                encoding.max_bitrate_bps;
            senderParameters.encodings.front().max_framerate =
                encoding.max_framerate;
        }
        senderParameters.degradation_preference =
            ToWebRtcPreference(options.degradationPreference);
        const auto parameterResult =
            transceiver->sender()->SetParameters(senderParameters);
        if (!parameterResult.ok())
        {
            peer->connection->Close();
            throw std::runtime_error(
                "Applying native P2P video limits failed: " +
                std::string(parameterResult.message()));
        }

        webrtc::BitrateSettings bitrate;
        bitrate.min_bitrate_bps = static_cast<int>(
            std::min<std::uint32_t>(
                std::min(options.minBitrateBps, options.maxBitrateBps),
                static_cast<std::uint32_t>(std::numeric_limits<int>::max())));
        bitrate.start_bitrate_bps = static_cast<int>(
            std::min<std::uint32_t>(
                options.startBitrateBps,
                static_cast<std::uint32_t>(std::numeric_limits<int>::max())));
        bitrate.max_bitrate_bps = static_cast<int>(
            std::min<std::uint32_t>(
                options.maxBitrateBps,
                static_cast<std::uint32_t>(std::numeric_limits<int>::max())));
        (void)peer->connection->SetBitrate(bitrate);

        {
            std::lock_guard lock(mutex_);
            if (peers_.contains(peer->id) ||
                peers_.size() >= options.maximumPeers)
            {
                peer->connection->Close();
                throw std::runtime_error(
                    "The native P2P viewer set changed while connecting.");
            }
            peers_.emplace(peer->id, peer);
        }

        peer->connection->CreateOffer(
            webrtc::make_ref_counted<CreateOfferObserver>(peer).get(),
            webrtc::PeerConnectionInterface::RTCOfferAnswerOptions());
    }

    void SetRemoteAnswer(const std::string& peerId, const std::string& sdp)
    {
        const auto peer = Find(peerId);
        webrtc::SdpParseError parseError;
        auto answer = webrtc::CreateSessionDescription(
            webrtc::SdpType::kAnswer,
            sdp,
            &parseError);
        if (!answer)
        {
            throw std::invalid_argument(
                "The P2P answer SDP is invalid: " + parseError.description);
        }
        peer->connection->SetRemoteDescription(
            std::move(answer),
            webrtc::make_ref_counted<SetRemoteObserver>(peer));
    }

    void AddRemoteIceCandidate(
        const std::string& peerId,
        const std::string& sdpMid,
        const int sdpMLineIndex,
        const std::string& candidate)
    {
        if (sdpMLineIndex < 0 || candidate.empty())
        {
            throw std::invalid_argument("The P2P ICE candidate is invalid.");
        }
        const auto peer = Find(peerId);
        PendingCandidate pending{
            .sdpMid = sdpMid,
            .sdpMLineIndex = sdpMLineIndex,
            .candidate = candidate,
        };
        {
            std::lock_guard lock(peer->mutex);
            if (!peer->remoteDescriptionSet)
            {
                if (peer->pendingRemoteCandidates.size() >= 64)
                {
                    throw std::runtime_error(
                        "Too many pending P2P ICE candidates.");
                }
                peer->pendingRemoteCandidates.push_back(std::move(pending));
                return;
            }
        }
        AddCandidateNow(peer, std::move(pending));
    }

    void RemoveViewer(const std::string& peerId) noexcept
    {
        std::shared_ptr<Peer> peer;
        {
            std::lock_guard lock(mutex_);
            const auto it = peers_.find(peerId);
            if (it == peers_.end())
            {
                return;
            }
            peer = std::move(it->second);
            peers_.erase(it);
        }
        ClosePeer(peer);
    }

    void Close() noexcept
    {
        std::map<std::string, std::shared_ptr<Peer>> peers;
        {
            std::lock_guard lock(mutex_);
            peers.swap(peers_);
        }
        for (auto& [id, peer] : peers)
        {
            (void)id;
            ClosePeer(peer);
        }
    }

    [[nodiscard]] bool HasViewer(const std::string& peerId) const noexcept
    {
        std::lock_guard lock(mutex_);
        return peers_.contains(peerId);
    }

    [[nodiscard]] std::size_t ViewerCount() const noexcept
    {
        std::lock_guard lock(mutex_);
        return peers_.size();
    }

private:
    std::shared_ptr<Peer> Find(const std::string& peerId) const
    {
        std::lock_guard lock(mutex_);
        const auto it = peers_.find(peerId);
        if (it == peers_.end())
        {
            throw std::out_of_range("The P2P viewer does not exist.");
        }
        return it->second;
    }

    static void ClosePeer(const std::shared_ptr<Peer>& peer) noexcept
    {
        if (!peer ||
            peer->closed.exchange(true, std::memory_order_acq_rel))
        {
            return;
        }
        if (peer->connection)
        {
            peer->connection->Close();
            peer->connection = nullptr;
        }
        {
            std::lock_guard lock(peer->mutex);
            peer->pendingLocalCandidates.clear();
            peer->pendingRemoteCandidates.clear();
        }
        InvokeNoThrow(
            peer->callbacks.connectionStateChanged,
            peer->id,
            P2pConnectionState::Closed,
            peer->route.load(std::memory_order_acquire));
        peer->observer.reset();
    }

    webrtc::scoped_refptr<webrtc::PeerConnectionFactoryInterface> factory_;
    mutable std::mutex mutex_;
    std::map<std::string, std::shared_ptr<Peer>> peers_;
};

P2pPublisher::P2pPublisher(
    webrtc::scoped_refptr<webrtc::PeerConnectionFactoryInterface> factory)
    : impl_(std::make_unique<Impl>(std::move(factory)))
{
}

P2pPublisher::~P2pPublisher() = default;
P2pPublisher::P2pPublisher(P2pPublisher&&) noexcept = default;
P2pPublisher& P2pPublisher::operator=(P2pPublisher&&) noexcept = default;

void P2pPublisher::AddViewer(
    std::string peerId,
    webrtc::scoped_refptr<webrtc::VideoTrackInterface> track,
    P2pPublishOptions options,
    P2pSignalingCallbacks callbacks)
{
    impl_->AddViewer(
        std::move(peerId),
        std::move(track),
        std::move(options),
        std::move(callbacks));
}

void P2pPublisher::SetRemoteAnswer(
    const std::string& peerId,
    const std::string& sdp)
{
    impl_->SetRemoteAnswer(peerId, sdp);
}

void P2pPublisher::AddRemoteIceCandidate(
    const std::string& peerId,
    const std::string& sdpMid,
    const int sdpMLineIndex,
    const std::string& candidate)
{
    impl_->AddRemoteIceCandidate(
        peerId,
        sdpMid,
        sdpMLineIndex,
        candidate);
}

void P2pPublisher::RemoveViewer(const std::string& peerId) noexcept
{
    impl_->RemoveViewer(peerId);
}

void P2pPublisher::Close() noexcept
{
    impl_->Close();
}

bool P2pPublisher::HasViewer(const std::string& peerId) const noexcept
{
    return impl_->HasViewer(peerId);
}

std::size_t P2pPublisher::ViewerCount() const noexcept
{
    return impl_->ViewerCount();
}
} // namespace poio::share
