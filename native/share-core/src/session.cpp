#include "poio/share/session.hpp"

#include "poio/share/capture.hpp"
#include "poio/share/webrtc.hpp"

#include <atomic>
#include <memory>
#include <mutex>
#include <stdexcept>
#include <utility>

namespace poio::share
{
class NativeShareSession::Impl
{
public:
    struct FrameForwarder
    {
        void Push(const CapturedTextureFrame& frame)
        {
            capturedFrames.fetch_add(1, std::memory_order_relaxed);

            std::lock_guard lock(sourceMutex);
            if (source == nullptr)
            {
                rejectedFrames.fetch_add(1, std::memory_order_relaxed);
                return;
            }

            switch (source->PushTexture(
                    frame.texture,
                    frame.width,
                    frame.height,
                    frame.capturedAt))
            {
            case NativeVideoPushResult::Delivered:
                submittedFrames.fetch_add(1, std::memory_order_relaxed);
                width.store(
                    source->outputWidth(),
                    std::memory_order_relaxed);
                height.store(
                    source->outputHeight(),
                    std::memory_order_relaxed);
                break;
            case NativeVideoPushResult::Paced:
                pacedFrames.fetch_add(1, std::memory_order_relaxed);
                break;
            case NativeVideoPushResult::Rejected:
                rejectedFrames.fetch_add(1, std::memory_order_relaxed);
                break;
            }
        }

        void Disconnect() noexcept
        {
            std::lock_guard lock(sourceMutex);
            source = nullptr;
        }

        mutable std::mutex sourceMutex;
        NativeVideoSource* source{ nullptr };
        std::atomic_uint64_t capturedFrames{ 0 };
        std::atomic_uint64_t submittedFrames{ 0 };
        std::atomic_uint64_t pacedFrames{ 0 };
        std::atomic_uint64_t rejectedFrames{ 0 };
        std::atomic_uint32_t width{ 0 };
        std::atomic_uint32_t height{ 0 };
    };

    std::string Start(NativeShareConfig config)
    {
        std::lock_guard lock(lifecycleMutex);
        if (config.sourceId.empty())
        {
            throw std::invalid_argument("A Windows Graphics Capture source id is required.");
        }
        const bool originalResolution =
            config.publish.maxWidth == 0 &&
            config.publish.maxHeight == 0;
        const bool boundedResolution =
            config.publish.maxWidth >= 320 &&
            config.publish.maxWidth <= 7680 &&
            config.publish.maxHeight >= 180 &&
            config.publish.maxHeight <= 4320;
        if (!originalResolution && !boundedResolution)
        {
            throw std::invalid_argument(
                "The native screen-share output dimensions are invalid.");
        }
        if (running.load(std::memory_order_acquire))
        {
            throw std::logic_error("The native screen share session is already running.");
        }

        StopUnlocked();
        forwarder = std::make_shared<FrameForwarder>();
        const auto activeForwarder = forwarder;

        try
        {
            capture = std::make_unique<CaptureSession>(
                CaptureSessionConfig{
                    .sourceId = std::move(config.sourceId),
                    .captureCursor = config.captureCursor,
                },
                [activeForwarder](const CapturedTextureFrame& frame)
                {
                    activeForwarder->Push(frame);
                },
                std::move(config.captureError));

            source = std::make_unique<NativeVideoSource>(
                config.publish.maxFrameRate,
                config.publish.maxWidth,
                config.publish.maxHeight);
            {
                std::lock_guard sourceLock(activeForwarder->sourceMutex);
                activeForwarder->source = source.get();
            }

            runtime = std::make_unique<WebRtcRuntime>(
                capture->device(),
                capture->adapterName(),
                config.publish.contentMode);
            track = runtime->CreateVideoTrack(*source, "poio-native-screen");
            if (!track)
            {
                throw std::runtime_error("The native WebRTC screen track could not be created.");
            }

            p2pPublisher =
                std::make_unique<P2pPublisher>(runtime->factory());
            publisher = std::make_unique<SfuPublisher>();
            publisher->Open(
                config.routerRtpCapabilitiesJson,
                config.transport,
                runtime->factory().get(),
                std::move(config.signaling));
            const auto id = publisher->StartVideo(track.get(), config.publish);

            capture->Start();
            running.store(true, std::memory_order_release);
            return id;
        }
        catch (...)
        {
            StopUnlocked();
            throw;
        }
    }

    void AddP2pViewer(
        std::string peerId,
        P2pPublishOptions options,
        P2pSignalingCallbacks callbacks)
    {
        std::lock_guard lock(lifecycleMutex);
        if (!running.load(std::memory_order_acquire) ||
            !p2pPublisher ||
            !track)
        {
            throw std::logic_error(
                "The native screen share session is not running.");
        }
        p2pPublisher->AddViewer(
            std::move(peerId),
            track,
            std::move(options),
            std::move(callbacks));
    }

    void SetP2pRemoteAnswer(
        const std::string& peerId,
        const std::string& sdp)
    {
        std::lock_guard lock(lifecycleMutex);
        if (!p2pPublisher)
        {
            throw std::logic_error(
                "The native P2P publisher is not running.");
        }
        p2pPublisher->SetRemoteAnswer(peerId, sdp);
    }

    void AddP2pRemoteIceCandidate(
        const std::string& peerId,
        const std::string& sdpMid,
        const int sdpMLineIndex,
        const std::string& candidate)
    {
        std::lock_guard lock(lifecycleMutex);
        if (!p2pPublisher)
        {
            throw std::logic_error(
                "The native P2P publisher is not running.");
        }
        p2pPublisher->AddRemoteIceCandidate(
            peerId,
            sdpMid,
            sdpMLineIndex,
            candidate);
    }

    void RemoveP2pViewer(const std::string& peerId) noexcept
    {
        std::lock_guard lock(lifecycleMutex);
        if (p2pPublisher)
        {
            p2pPublisher->RemoveViewer(peerId);
        }
    }

    void SetSfuPaused(const bool paused)
    {
        std::lock_guard lock(lifecycleMutex);
        if (!publisher || !publisher->IsPublishing())
        {
            throw std::logic_error(
                "The native SFU publisher is not running.");
        }
        if (paused)
        {
            publisher->PauseVideo();
        }
        else
        {
            publisher->ResumeVideo();
        }
    }

    void Stop() noexcept
    {
        std::lock_guard lock(lifecycleMutex);
        StopUnlocked();
    }

    void StopUnlocked() noexcept
    {
        running.store(false, std::memory_order_release);

        if (forwarder)
        {
            forwarder->Disconnect();
        }
        if (capture)
        {
            capture->Stop();
        }
        if (p2pPublisher)
        {
            p2pPublisher->Close();
        }
        if (publisher)
        {
            try
            {
                publisher->StopVideo();
                publisher->Close();
            }
            catch (...)
            {
            }
        }

        p2pPublisher.reset();
        publisher.reset();
        track = nullptr;
        runtime.reset();
        source.reset();
        capture.reset();
    }

    [[nodiscard]] NativeShareStats Stats() const noexcept
    {
        std::lock_guard lock(lifecycleMutex);
        NativeShareStats result;
        const auto current = forwarder;
        if (current)
        {
            result.capturedFrames =
                current->capturedFrames.load(std::memory_order_relaxed);
            result.submittedFrames =
                current->submittedFrames.load(std::memory_order_relaxed);
            result.pacedFrames =
                current->pacedFrames.load(std::memory_order_relaxed);
            result.rejectedFrames =
                current->rejectedFrames.load(std::memory_order_relaxed);
            result.width = current->width.load(std::memory_order_relaxed);
            result.height = current->height.load(std::memory_order_relaxed);
        }
        if (publisher)
        {
            result.sfuStatsJson = publisher->StatsJson();
        }
        return result;
    }

    [[nodiscard]] std::string ProducerId() const
    {
        std::lock_guard lock(lifecycleMutex);
        return publisher ? publisher->ProducerId() : std::string{};
    }

    [[nodiscard]] std::size_t P2pViewerCount() const noexcept
    {
        std::lock_guard lock(lifecycleMutex);
        return p2pPublisher ? p2pPublisher->ViewerCount() : 0;
    }

    std::atomic_bool running{ false };
    mutable std::recursive_mutex lifecycleMutex;
    std::shared_ptr<FrameForwarder> forwarder;
    std::unique_ptr<CaptureSession> capture;
    std::unique_ptr<NativeVideoSource> source;
    std::unique_ptr<WebRtcRuntime> runtime;
    webrtc::scoped_refptr<webrtc::VideoTrackInterface> track;
    std::unique_ptr<P2pPublisher> p2pPublisher;
    std::unique_ptr<SfuPublisher> publisher;
};

NativeShareSession::NativeShareSession()
    : impl_(std::make_unique<Impl>())
{
}

NativeShareSession::~NativeShareSession()
{
    impl_->Stop();
}

std::string NativeShareSession::Start(NativeShareConfig config)
{
    return impl_->Start(std::move(config));
}

void NativeShareSession::AddP2pViewer(
    std::string peerId,
    P2pPublishOptions options,
    P2pSignalingCallbacks callbacks)
{
    impl_->AddP2pViewer(
        std::move(peerId),
        std::move(options),
        std::move(callbacks));
}

void NativeShareSession::SetP2pRemoteAnswer(
    const std::string& peerId,
    const std::string& sdp)
{
    impl_->SetP2pRemoteAnswer(peerId, sdp);
}

void NativeShareSession::AddP2pRemoteIceCandidate(
    const std::string& peerId,
    const std::string& sdpMid,
    const int sdpMLineIndex,
    const std::string& candidate)
{
    impl_->AddP2pRemoteIceCandidate(
        peerId,
        sdpMid,
        sdpMLineIndex,
        candidate);
}

void NativeShareSession::RemoveP2pViewer(
    const std::string& peerId) noexcept
{
    impl_->RemoveP2pViewer(peerId);
}

void NativeShareSession::SetSfuPaused(const bool paused)
{
    impl_->SetSfuPaused(paused);
}

void NativeShareSession::Stop() noexcept
{
    impl_->Stop();
}

bool NativeShareSession::running() const noexcept
{
    return impl_->running.load(std::memory_order_acquire);
}

NativeShareStats NativeShareSession::stats() const noexcept
{
    return impl_->Stats();
}

std::string NativeShareSession::producerId() const
{
    return impl_->ProducerId();
}

std::size_t NativeShareSession::p2pViewerCount() const noexcept
{
    return impl_->P2pViewerCount();
}
} // namespace poio::share
