#pragma once

#include "poio/share/webrtc.hpp"

#include <cstdint>
#include <functional>
#include <future>
#include <memory>
#include <string>

namespace poio::share
{
struct SfuTransportDescription
{
    std::string id;
    std::string iceParametersJson;
    std::string iceCandidatesJson;
    std::string dtlsParametersJson;
    std::string sctpParametersJson{ "null" };
};

struct SfuPublishOptions
{
    std::uint32_t minBitrateBps{ 1'000'000 };
    std::uint32_t startBitrateBps{ 4'000'000 };
    std::uint32_t maxBitrateBps{ 20'000'000 };
    double maxFrameRate{ 60.0 };
    std::uint32_t maxWidth{ 1920 };
    std::uint32_t maxHeight{ 1080 };
    std::string appDataJson{ R"({"mediaTag":"screen","native":true})" };
    ScreenContentMode contentMode{ ScreenContentMode::Motion };
};

struct SfuSignalingCallbacks
{
    std::function<std::future<void>(
        const std::string& transportId,
        const std::string& dtlsParametersJson)>
        connectTransport;

    std::function<std::future<std::string>(
        const std::string& transportId,
        const std::string& kind,
        const std::string& rtpParametersJson,
        const std::string& appDataJson)>
        produce;

    std::function<void(const std::string& connectionState)> connectionStateChanged;
    std::function<void(const std::string& producerId)> producerTransportClosed;
};

class SfuPublisher final
{
public:
    SfuPublisher();
    ~SfuPublisher();

    SfuPublisher(const SfuPublisher&) = delete;
    SfuPublisher& operator=(const SfuPublisher&) = delete;
    SfuPublisher(SfuPublisher&&) noexcept;
    SfuPublisher& operator=(SfuPublisher&&) noexcept;

    void Open(
        const std::string& routerRtpCapabilitiesJson,
        const SfuTransportDescription& transport,
        webrtc::PeerConnectionFactoryInterface* factory,
        SfuSignalingCallbacks callbacks);
    std::string StartVideo(
        webrtc::VideoTrackInterface* track,
        const SfuPublishOptions& options = {});
    void PauseVideo();
    void ResumeVideo();
    void StopVideo();
    void Close();

    [[nodiscard]] bool IsOpen() const noexcept;
    [[nodiscard]] bool IsPublishing() const noexcept;
    [[nodiscard]] bool IsPaused() const noexcept;
    [[nodiscard]] std::string ProducerId() const;
    [[nodiscard]] std::string StatsJson() const noexcept;

private:
    class Impl;
    std::unique_ptr<Impl> impl_;
};
} // namespace poio::share
