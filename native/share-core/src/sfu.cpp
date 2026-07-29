#include "poio/share/sfu.hpp"

#include <Device.hpp>
#include <Producer.hpp>
#include <Transport.hpp>
#include <mediasoupclient.hpp>

#include <api/priority.h>
#include <api/rtp_parameters.h>
#include <json.hpp>

#include <algorithm>
#include <limits>
#include <mutex>
#include <stdexcept>
#include <utility>
#include <vector>

namespace poio::share
{
namespace
{
using Json = nlohmann::json;

Json ParseJson(const std::string& value, const char* field)
{
    try
    {
        return Json::parse(value);
    }
    catch (const std::exception& exception)
    {
        throw std::invalid_argument(
            std::string("Invalid JSON in ") + field + ": " + exception.what());
    }
}
} // namespace

class SfuPublisher::Impl final : public mediasoupclient::SendTransport::Listener,
                                 public mediasoupclient::Producer::Listener
{
public:
    Impl()
    {
        mediasoupclient::Initialize();
    }

    ~Impl() override
    {
        try
        {
            Close();
        }
        catch (...)
        {
        }
        try
        {
            mediasoupclient::Cleanup();
        }
        catch (...)
        {
        }
    }

    void Open(
        const std::string& routerRtpCapabilitiesJson,
        const SfuTransportDescription& description,
        webrtc::PeerConnectionFactoryInterface* factory,
        SfuSignalingCallbacks callbacks)
    {
        if (factory == nullptr)
        {
            throw std::invalid_argument("The WebRTC peer connection factory is required.");
        }
        if (description.id.empty())
        {
            throw std::invalid_argument("The mediasoup transport id is required.");
        }
        if (!callbacks.connectTransport || !callbacks.produce)
        {
            throw std::invalid_argument("Both mediasoup signaling callbacks are required.");
        }

        Close();

        auto routerCapabilities =
            ParseJson(routerRtpCapabilitiesJson, "routerRtpCapabilities");
        auto iceParameters = ParseJson(description.iceParametersJson, "iceParameters");
        auto iceCandidates = ParseJson(description.iceCandidatesJson, "iceCandidates");
        auto dtlsParameters = ParseJson(description.dtlsParametersJson, "dtlsParameters");
        auto sctpParameters = ParseJson(description.sctpParametersJson, "sctpParameters");

        pcOptions_.factory = factory;
        callbacks_ = std::move(callbacks);
        transportId_ = description.id;

        try
        {
            device_ = std::make_unique<mediasoupclient::Device>();
            device_->Load(std::move(routerCapabilities), &pcOptions_, true);
            if (!device_->CanProduce("video"))
            {
                throw std::runtime_error(
                    "The mediasoup router and native WebRTC factory have no common video codec.");
            }

            if (sctpParameters.is_null())
            {
                transport_.reset(device_->CreateSendTransport(
                    this,
                    transportId_,
                    iceParameters,
                    iceCandidates,
                    dtlsParameters,
                    &pcOptions_));
            }
            else
            {
                transport_.reset(device_->CreateSendTransport(
                    this,
                    transportId_,
                    iceParameters,
                    iceCandidates,
                    dtlsParameters,
                    sctpParameters,
                    &pcOptions_));
            }
            if (!transport_)
            {
                throw std::runtime_error("libmediasoupclient did not create a send transport.");
            }
        }
        catch (...)
        {
            Close();
            throw;
        }
    }

    std::string StartVideo(
        webrtc::VideoTrackInterface* track,
        const SfuPublishOptions& options)
    {
        if (!transport_ || transport_->IsClosed())
        {
            throw std::logic_error("The mediasoup send transport is not open.");
        }
        if (track == nullptr)
        {
            throw std::invalid_argument("The native screen video track is required.");
        }
        if (options.minBitrateBps == 0 ||
            options.startBitrateBps == 0 ||
            options.maxBitrateBps == 0 ||
            options.minBitrateBps > options.startBitrateBps ||
            options.startBitrateBps > options.maxBitrateBps)
        {
            throw std::invalid_argument(
                "The video min/start/max bitrate range must be ordered and greater than zero.");
        }
        if (options.maxFrameRate <= 0.0)
        {
            throw std::invalid_argument("The video maximum frame rate must be greater than zero.");
        }

        StopVideo();

        std::vector<webrtc::RtpEncodingParameters> encodings(1);
        auto& encoding = encodings.front();
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

        const auto appData = ParseJson(options.appDataJson, "appData");
        const auto minBitrateKbps = std::max<std::uint32_t>(
            1,
            options.minBitrateBps / 1'000);
        const auto startBitrateKbps = std::max<std::uint32_t>(
            minBitrateKbps,
            options.startBitrateBps / 1'000);
        const auto maxBitrateKbps = std::max<std::uint32_t>(
            startBitrateKbps,
            options.maxBitrateBps / 1'000);
        const Json codecOptions = {
            { "videoGoogleStartBitrate", startBitrateKbps },
            { "videoGoogleMinBitrate", minBitrateKbps },
            { "videoGoogleMaxBitrate", maxBitrateKbps },
        };
        producer_.reset(transport_->Produce(
            this,
            track,
            &encodings,
            &codecOptions,
            nullptr,
            appData));
        if (!producer_)
        {
            throw std::runtime_error("libmediasoupclient did not create a video producer.");
        }

        std::lock_guard lock(stateMutex_);
        producerId_ = producer_->GetId();
        paused_ = false;
        return producerId_;
    }

    void StopVideo()
    {
        if (producer_)
        {
            producer_->Close();
            producer_.reset();
        }
        std::lock_guard lock(stateMutex_);
        producerId_.clear();
        paused_ = false;
    }

    void PauseVideo()
    {
        if (!producer_ || producer_->IsClosed())
        {
            throw std::logic_error("The mediasoup video producer is not active.");
        }
        SetSenderActive(false);
        std::lock_guard lock(stateMutex_);
        paused_ = true;
    }

    void ResumeVideo()
    {
        if (!producer_ || producer_->IsClosed())
        {
            throw std::logic_error("The mediasoup video producer is not active.");
        }
        SetSenderActive(true);
        std::lock_guard lock(stateMutex_);
        paused_ = false;
    }

    void Close()
    {
        StopVideo();
        if (transport_)
        {
            transport_->Close();
            transport_.reset();
        }
        device_.reset();
        pcOptions_ = {};
        callbacks_ = {};
        transportId_.clear();
    }

    [[nodiscard]] bool IsOpen() const noexcept
    {
        return transport_ && !transport_->IsClosed();
    }

    [[nodiscard]] bool IsPublishing() const noexcept
    {
        return producer_ && !producer_->IsClosed();
    }

    [[nodiscard]] bool IsPaused() const noexcept
    {
        std::lock_guard lock(stateMutex_);
        return producer_ &&
            !producer_->IsClosed() &&
            paused_;
    }

    [[nodiscard]] std::string ProducerId() const
    {
        std::lock_guard lock(stateMutex_);
        return producerId_;
    }

    [[nodiscard]] std::string StatsJson() const noexcept
    {
        try
        {
            if (!transport_ || transport_->IsClosed())
            {
                return "[]";
            }
            return transport_->GetStats().dump();
        }
        catch (...)
        {
            return "[]";
        }
    }

private:
    void SetSenderActive(const bool active)
    {
        auto* sender = producer_->GetRtpSender();
        if (sender == nullptr)
        {
            throw std::runtime_error(
                "The mediasoup video producer has no RTP sender.");
        }
        auto parameters = sender->GetParameters();
        if (parameters.encodings.empty())
        {
            throw std::runtime_error(
                "The mediasoup video producer has no RTP encoding.");
        }
        for (auto& encoding : parameters.encodings)
        {
            encoding.active = active;
        }
        const auto result = sender->SetParameters(parameters);
        if (!result.ok())
        {
            throw std::runtime_error(
                "Changing the SFU video sender state failed: " +
                std::string(result.message()));
        }
    }

    std::future<void> OnConnect(
        mediasoupclient::Transport*,
        const Json& dtlsParameters) override
    {
        return callbacks_.connectTransport(transportId_, dtlsParameters.dump());
    }

    void OnConnectionStateChange(
        mediasoupclient::Transport*,
        const std::string& connectionState) override
    {
        if (callbacks_.connectionStateChanged)
        {
            callbacks_.connectionStateChanged(connectionState);
        }
    }

    std::future<std::string> OnProduce(
        mediasoupclient::SendTransport*,
        const std::string& kind,
        Json rtpParameters,
        const Json& appData) override
    {
        return callbacks_.produce(
            transportId_,
            kind,
            rtpParameters.dump(),
            appData.dump());
    }

    std::future<std::string> OnProduceData(
        mediasoupclient::SendTransport*,
        const Json&,
        const std::string&,
        const std::string&,
        const Json&) override
    {
        std::promise<std::string> rejected;
        rejected.set_exception(std::make_exception_ptr(
            std::logic_error("The POIO native screen publisher does not produce data channels.")));
        return rejected.get_future();
    }

    void OnTransportClose(mediasoupclient::Producer* producer) override
    {
        std::string id;
        if (producer != nullptr)
        {
            id = producer->GetId();
        }
        {
            std::lock_guard lock(stateMutex_);
            if (id.empty())
            {
                id = producerId_;
            }
            producerId_.clear();
        }
        if (callbacks_.producerTransportClosed)
        {
            callbacks_.producerTransportClosed(id);
        }
    }

    mediasoupclient::PeerConnection::Options pcOptions_;
    SfuSignalingCallbacks callbacks_;
    std::string transportId_;
    std::unique_ptr<mediasoupclient::Device> device_;
    std::unique_ptr<mediasoupclient::SendTransport> transport_;
    std::unique_ptr<mediasoupclient::Producer> producer_;
    mutable std::mutex stateMutex_;
    std::string producerId_;
    bool paused_{ false };
};

SfuPublisher::SfuPublisher()
    : impl_(std::make_unique<Impl>())
{
}

SfuPublisher::~SfuPublisher() = default;

SfuPublisher::SfuPublisher(SfuPublisher&&) noexcept = default;

SfuPublisher& SfuPublisher::operator=(SfuPublisher&&) noexcept = default;

void SfuPublisher::Open(
    const std::string& routerRtpCapabilitiesJson,
    const SfuTransportDescription& transport,
    webrtc::PeerConnectionFactoryInterface* factory,
    SfuSignalingCallbacks callbacks)
{
    impl_->Open(
        routerRtpCapabilitiesJson,
        transport,
        factory,
        std::move(callbacks));
}

std::string SfuPublisher::StartVideo(
    webrtc::VideoTrackInterface* track,
    const SfuPublishOptions& options)
{
    return impl_->StartVideo(track, options);
}

void SfuPublisher::PauseVideo()
{
    impl_->PauseVideo();
}

void SfuPublisher::ResumeVideo()
{
    impl_->ResumeVideo();
}

void SfuPublisher::StopVideo()
{
    impl_->StopVideo();
}

void SfuPublisher::Close()
{
    impl_->Close();
}

bool SfuPublisher::IsOpen() const noexcept
{
    return impl_->IsOpen();
}

bool SfuPublisher::IsPublishing() const noexcept
{
    return impl_->IsPublishing();
}

bool SfuPublisher::IsPaused() const noexcept
{
    return impl_->IsPaused();
}

std::string SfuPublisher::ProducerId() const
{
    return impl_->ProducerId();
}

std::string SfuPublisher::StatsJson() const noexcept
{
    return impl_->StatsJson();
}
} // namespace poio::share
