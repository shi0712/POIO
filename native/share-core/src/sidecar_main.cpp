#include "poio/share/diagnostics.hpp"
#include "poio/share/session.hpp"

#include <Windows.h>

#include <fcntl.h>
#include <io.h>
#include <json.hpp>

#define MSC_CLASS "PoioShareSidecar"
#include <Logger.hpp>
#include <rtc_base/logging.h>

#include <chrono>
#include <atomic>
#include <condition_variable>
#include <cstdint>
#include <deque>
#include <exception>
#include <functional>
#include <future>
#include <iostream>
#include <limits>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <stdexcept>
#include <string>
#include <thread>
#include <utility>

namespace
{
using Json = nlohmann::json;

class StderrMediaSoupLogger final : public mediasoupclient::Logger::LogHandlerInterface
{
public:
    void OnLog(
        mediasoupclient::Logger::LogLevel,
        char* payload,
        size_t length) override
    {
        std::cerr.write(payload, static_cast<std::streamsize>(length));
        std::cerr << '\n';
    }
};

bool DebugLoggingEnabled() noexcept
{
    wchar_t value[8]{};
    const DWORD length = GetEnvironmentVariableW(
        L"POIO_SHARE_DEBUG",
        value,
        static_cast<DWORD>(std::size(value)));
    return length > 0 && value[0] != L'0';
}

class JsonWriter
{
public:
    void Write(Json value) noexcept
    {
        try
        {
            const std::string line = value.dump();
            std::lock_guard lock(mutex_);
            std::cout << line << '\n';
            std::cout.flush();
        }
        catch (...)
        {
        }
    }

    void Response(const Json& id, Json result)
    {
        Write({
            { "type", "response" },
            { "id", id },
            { "ok", true },
            { "result", std::move(result) },
        });
    }

    void Error(const Json& id, const std::string& error)
    {
        Write({
            { "type", "response" },
            { "id", id },
            { "ok", false },
            { "error", error },
        });
    }

    void Event(const std::string& event, Json data)
    {
        Write({
            { "type", "event" },
            { "event", event },
            { "data", std::move(data) },
        });
    }

private:
    std::mutex mutex_;
};

class RequestBroker
{
private:
    struct Pending
    {
        std::function<void(const Json&)> resolve;
        std::function<void(const std::string&)> reject;
    };

    struct State
    {
        std::mutex mutex;
        std::map<std::string, Pending> pending;
        std::atomic_uint64_t nextId{ 1 };
    };

public:
    explicit RequestBroker(JsonWriter& writer)
        : writer_(writer),
          state_(std::make_shared<State>())
    {
    }

    std::future<void> RequestVoid(
        const std::string& request,
        Json data)
    {
        auto promise = std::make_shared<std::promise<void>>();
        auto future = promise->get_future();
        Add(
            request,
            std::move(data),
            [promise](const Json&)
            {
                promise->set_value();
            },
            [promise](const std::string& error)
            {
                promise->set_exception(
                    std::make_exception_ptr(std::runtime_error(error)));
            });
        return future;
    }

    std::future<std::string> RequestProducer(
        const std::string& request,
        Json data)
    {
        auto promise = std::make_shared<std::promise<std::string>>();
        auto future = promise->get_future();
        Add(
            request,
            std::move(data),
            [promise](const Json& result)
            {
                if (result.is_string())
                {
                    promise->set_value(result.get<std::string>());
                    return;
                }
                if (result.is_object() &&
                    result.contains("id") &&
                    result["id"].is_string())
                {
                    promise->set_value(result["id"].get<std::string>());
                    return;
                }
                promise->set_exception(std::make_exception_ptr(
                    std::runtime_error(
                        "The signaling response did not contain a producer id.")));
            },
            [promise](const std::string& error)
            {
                promise->set_exception(
                    std::make_exception_ptr(std::runtime_error(error)));
            });
        return future;
    }

    bool Resolve(
        const std::string& requestId,
        const bool ok,
        const Json& result,
        const std::string& error)
    {
        Pending pending;
        {
            std::lock_guard lock(state_->mutex);
            const auto it = state_->pending.find(requestId);
            if (it == state_->pending.end())
            {
                return false;
            }
            pending = std::move(it->second);
            state_->pending.erase(it);
        }
        try
        {
            if (ok)
            {
                pending.resolve(result);
            }
            else
            {
                pending.reject(
                    error.empty() ? "The signaling request failed." : error);
            }
        }
        catch (...)
        {
        }
        return true;
    }

    void RejectAll(const std::string& error) noexcept
    {
        std::map<std::string, Pending> pending;
        {
            std::lock_guard lock(state_->mutex);
            pending.swap(state_->pending);
        }
        for (auto& [id, request] : pending)
        {
            (void)id;
            try
            {
                request.reject(error);
            }
            catch (...)
            {
            }
        }
    }

private:
    void Add(
        const std::string& request,
        Json data,
        std::function<void(const Json&)> resolve,
        std::function<void(const std::string&)> reject)
    {
        const std::string requestId =
            std::to_string(
                state_->nextId.fetch_add(1, std::memory_order_relaxed));
        {
            std::lock_guard lock(state_->mutex);
            state_->pending.emplace(
                requestId,
                Pending{
                    .resolve = std::move(resolve),
                    .reject = std::move(reject),
                });
        }
        writer_.Write({
            { "type", "request" },
            { "requestId", requestId },
            { "request", request },
            { "data", std::move(data) },
        });

        const auto weakState = std::weak_ptr<State>(state_);
        std::thread(
            [weakState, requestId]
            {
                std::this_thread::sleep_for(std::chrono::seconds(20));
                const auto state = weakState.lock();
                if (!state)
                {
                    return;
                }
                Pending pending;
                {
                    std::lock_guard lock(state->mutex);
                    const auto it = state->pending.find(requestId);
                    if (it == state->pending.end())
                    {
                        return;
                    }
                    pending = std::move(it->second);
                    state->pending.erase(it);
                }
                try
                {
                    pending.reject("The signaling request timed out.");
                }
                catch (...)
                {
                }
            })
            .detach();
    }

    JsonWriter& writer_;
    std::shared_ptr<State> state_;
};

std::string RequiredString(
    const Json& value,
    const char* name)
{
    if (!value.contains(name) || !value[name].is_string())
    {
        throw std::invalid_argument(
            std::string("Missing string field: ") + name);
    }
    return value[name].get<std::string>();
}

std::uint32_t UnsignedOr(
    const Json& value,
    const char* name,
    const std::uint32_t fallback)
{
    if (!value.contains(name))
    {
        return fallback;
    }
    const auto number = value[name].get<std::int64_t>();
    if (number < 0 ||
        number > static_cast<std::int64_t>(
            std::numeric_limits<std::uint32_t>::max()))
    {
        throw std::invalid_argument(
            std::string("Invalid unsigned field: ") + name);
    }
    return static_cast<std::uint32_t>(number);
}

double DoubleOr(
    const Json& value,
    const char* name,
    const double fallback)
{
    return value.contains(name) ? value[name].get<double>() : fallback;
}

std::string P2pStateName(const poio::share::P2pConnectionState state)
{
    using State = poio::share::P2pConnectionState;
    switch (state)
    {
        case State::New:
            return "new";
        case State::Connecting:
            return "connecting";
        case State::Connected:
            return "connected";
        case State::Disconnected:
            return "disconnected";
        case State::Failed:
            return "failed";
        case State::Closed:
            return "closed";
    }
    return "failed";
}

std::string P2pRouteName(const poio::share::P2pRoute route)
{
    using Route = poio::share::P2pRoute;
    switch (route)
    {
        case Route::Unknown:
            return "unknown";
        case Route::Direct:
            return "p2p";
        case Route::Turn:
            return "turn";
    }
    return "unknown";
}

class Sidecar
{
public:
    Sidecar()
        : broker_(writer_)
    {
    }

    int Run()
    {
        worker_ = std::thread([this] { WorkerLoop(); });
        std::string line;
        while (std::getline(std::cin, line))
        {
            if (line.empty())
            {
                continue;
            }
            try
            {
                Json command = Json::parse(line);
                if (command.value("method", std::string{}) == "resolve")
                {
                    HandleResolve(command);
                    continue;
                }
                {
                    std::lock_guard lock(queueMutex_);
                    queue_.push_back(std::move(command));
                }
                queueReady_.notify_one();
            }
            catch (const std::exception& error)
            {
                writer_.Error(nullptr, error.what());
            }
        }

        broker_.RejectAll("The POIO parent process closed the IPC stream.");
        {
            std::lock_guard lock(queueMutex_);
            inputClosed_ = true;
        }
        queueReady_.notify_one();
        if (worker_.joinable())
        {
            worker_.join();
        }
        return 0;
    }

private:
    void HandleResolve(const Json& command)
    {
        const Json id = command.value("id", Json{});
        try
        {
            const Json params = command.value("params", Json::object());
            const bool found = broker_.Resolve(
                RequiredString(params, "requestId"),
                params.value("ok", false),
                params.value("result", Json{}),
                params.value("error", std::string{}));
            if (!id.is_null())
            {
                writer_.Response(id, found);
            }
        }
        catch (const std::exception& error)
        {
            if (!id.is_null())
            {
                writer_.Error(id, error.what());
            }
        }
    }

    void WorkerLoop() noexcept
    {
        for (;;)
        {
            Json command;
            {
                std::unique_lock lock(queueMutex_);
                queueReady_.wait(
                    lock,
                    [this]
                    {
                        return inputClosed_ || !queue_.empty();
                    });
                if (queue_.empty() && inputClosed_)
                {
                    break;
                }
                command = std::move(queue_.front());
                queue_.pop_front();
            }
            HandleCommand(command);
        }
        session_.Stop();
    }

    void HandleCommand(const Json& command) noexcept
    {
        const Json id = command.value("id", Json{});
        try
        {
            const std::string method = RequiredString(command, "method");
            const Json params = command.value("params", Json::object());
            if (method == "hello")
            {
                writer_.Response(
                    id,
                    {
                        { "name", "poio-share-sidecar" },
                        { "version", "0.1.0" },
                        { "protocol", "poio.share.ipc.v1" },
                        { "features",
                          { "wgc", "d3d11", "mf-h264", "webrtc",
                            "mediasoup", "p2p", "turn" } },
                    });
                return;
            }
            if (method == "probe")
            {
                writer_.Response(
                    id,
                    Json::parse(
                        poio::share::SerializeReport(
                            poio::share::ProbeSystem())));
                return;
            }
            if (method == "sources")
            {
                writer_.Response(
                    id,
                    Json::parse(
                        poio::share::SerializeSources(
                            poio::share::ProbeSystem())));
                return;
            }
            if (method == "start")
            {
                writer_.Response(id, Start(params));
                return;
            }
            if (method == "stop")
            {
                session_.Stop();
                broker_.RejectAll("The native screen share was stopped.");
                writer_.Response(id, true);
                return;
            }
            if (method == "stats")
            {
                writer_.Response(id, Stats());
                return;
            }
            if (method == "sfu.setPaused")
            {
                session_.SetSfuPaused(params.at("paused").get<bool>());
                writer_.Response(id, true);
                return;
            }
            if (method == "p2p.addViewer")
            {
                AddP2pViewer(params);
                writer_.Response(id, true);
                return;
            }
            if (method == "p2p.answer")
            {
                session_.SetP2pRemoteAnswer(
                    RequiredString(params, "peerId"),
                    RequiredString(params, "sdp"));
                writer_.Response(id, true);
                return;
            }
            if (method == "p2p.candidate")
            {
                session_.AddP2pRemoteIceCandidate(
                    RequiredString(params, "peerId"),
                    params.value("sdpMid", std::string{}),
                    params.at("sdpMLineIndex").get<int>(),
                    RequiredString(params, "candidate"));
                writer_.Response(id, true);
                return;
            }
            if (method == "p2p.removeViewer")
            {
                session_.RemoveP2pViewer(
                    RequiredString(params, "peerId"));
                writer_.Response(id, true);
                return;
            }
            if (method == "shutdown")
            {
                session_.Stop();
                broker_.RejectAll("The native screen sidecar is shutting down.");
                writer_.Response(id, true);
                return;
            }
            throw std::invalid_argument("Unknown method: " + method);
        }
        catch (const std::exception& error)
        {
            writer_.Error(id, error.what());
        }
        catch (...)
        {
            writer_.Error(id, "Unknown native sidecar failure.");
        }
    }

    Json Start(const Json& params)
    {
        const Json transport = params.at("transport");
        const Json publish = params.value("publish", Json::object());
        poio::share::NativeShareConfig config;
        config.sourceId = RequiredString(params, "sourceId");
        config.captureCursor = params.value("captureCursor", false);
        config.routerRtpCapabilitiesJson =
            params.at("routerRtpCapabilities").dump();
        config.transport = {
            .id = RequiredString(transport, "id"),
            .iceParametersJson = transport.at("iceParameters").dump(),
            .iceCandidatesJson = transport.at("iceCandidates").dump(),
            .dtlsParametersJson = transport.at("dtlsParameters").dump(),
            .sctpParametersJson = transport.contains("sctpParameters")
                ? transport["sctpParameters"].dump()
                : "null",
        };
        config.publish = {
            .minBitrateBps =
                UnsignedOr(publish, "minBitrateBps", 1'000'000),
            .startBitrateBps =
                UnsignedOr(publish, "startBitrateBps", 4'000'000),
            .maxBitrateBps =
                UnsignedOr(publish, "maxBitrateBps", 20'000'000),
            .maxFrameRate = DoubleOr(publish, "maxFrameRate", 60.0),
            .maxWidth = UnsignedOr(publish, "maxWidth", 1920),
            .maxHeight = UnsignedOr(publish, "maxHeight", 1080),
            .appDataJson = publish.contains("appData")
                ? publish["appData"].dump()
                : R"({"mediaTag":"screen","native":true})",
            .contentMode =
                publish.value("contentMode", std::string("motion")) == "detail"
                    ? poio::share::ScreenContentMode::Detail
                    : poio::share::ScreenContentMode::Motion,
        };
        config.signaling = {
            .connectTransport =
                [this](
                    const std::string& transportId,
                    const std::string& dtlsParameters)
                {
                    return broker_.RequestVoid(
                        "sfu.connectTransport",
                        {
                            { "transportId", transportId },
                            { "dtlsParameters",
                              Json::parse(dtlsParameters) },
                        });
                },
            .produce =
                [this](
                    const std::string& transportId,
                    const std::string& kind,
                    const std::string& rtpParameters,
                    const std::string& appData)
                {
                    return broker_.RequestProducer(
                        "sfu.produce",
                        {
                            { "transportId", transportId },
                            { "kind", kind },
                            { "rtpParameters",
                              Json::parse(rtpParameters) },
                            { "appData", Json::parse(appData) },
                        });
                },
            .connectionStateChanged =
                [this](const std::string& state)
                {
                    writer_.Event(
                        "sfu.connectionState",
                        { { "state", state } });
                },
            .producerTransportClosed =
                [this](const std::string& producerId)
                {
                    writer_.Event(
                        "sfu.producerClosed",
                        { { "producerId", producerId } });
                },
        };
        config.captureError =
            [this](const std::string& error)
            {
                writer_.Event(
                    "capture.error",
                    { { "error", error } });
            };

        const std::string producerId = session_.Start(std::move(config));
        return {
            { "producerId", producerId },
            { "running", true },
        };
    }

    void AddP2pViewer(const Json& params)
    {
        poio::share::P2pPublishOptions options;
        const Json configured = params.value("options", Json::object());
        options.minBitrateBps =
            UnsignedOr(configured, "minBitrateBps", options.minBitrateBps);
        options.startBitrateBps =
            UnsignedOr(configured, "startBitrateBps", options.startBitrateBps);
        options.maxBitrateBps =
            UnsignedOr(configured, "maxBitrateBps", options.maxBitrateBps);
        options.maxFrameRate =
            DoubleOr(configured, "maxFrameRate", options.maxFrameRate);
        options.maximumPeers = configured.value(
            "maximumPeers",
            options.maximumPeers);
        options.iceCandidatePoolSize = configured.value(
            "iceCandidatePoolSize",
            options.iceCandidatePoolSize);
        options.forceTurn = configured.value("forceTurn", false);
        const std::string preference = configured.value(
            "degradationPreference",
            std::string("preserve-resolution"));
        if (preference == "preserve-frame-rate")
        {
            options.degradationPreference =
                poio::share::P2pDegradationPreference::PreserveFrameRate;
        }
        else if (preference == "balanced")
        {
            options.degradationPreference =
                poio::share::P2pDegradationPreference::Balanced;
        }
        else
        {
            options.degradationPreference =
                poio::share::P2pDegradationPreference::PreserveResolution;
        }
        if (configured.contains("iceServers"))
        {
            for (const auto& server : configured["iceServers"])
            {
                poio::share::P2pIceServer ice;
                if (server.contains("urls") &&
                    server["urls"].is_string())
                {
                    ice.urls.push_back(
                        server["urls"].get<std::string>());
                }
                else if (server.contains("urls"))
                {
                    ice.urls =
                        server["urls"].get<std::vector<std::string>>();
                }
                ice.username =
                    server.value("username", std::string{});
                ice.credential =
                    server.value("credential", std::string{});
                options.iceServers.push_back(std::move(ice));
            }
        }

        const std::string peerId = RequiredString(params, "peerId");
        session_.AddP2pViewer(
            peerId,
            std::move(options),
            {
                .localDescription =
                    [this](
                        const std::string& targetPeerId,
                        const std::string& type,
                        const std::string& sdp)
                    {
                        writer_.Event(
                            "p2p.signal",
                            {
                                { "targetPeerId", targetPeerId },
                                { "description",
                                  {
                                      { "type", type },
                                      { "sdp", sdp },
                                  } },
                            });
                    },
                .localCandidate =
                    [this](
                        const std::string& targetPeerId,
                        const std::string& sdpMid,
                        const int sdpMLineIndex,
                        const std::string& candidate)
                    {
                        writer_.Event(
                            "p2p.signal",
                            {
                                { "targetPeerId", targetPeerId },
                                { "candidate",
                                  {
                                      { "candidate", candidate },
                                      { "sdpMid", sdpMid },
                                      { "sdpMLineIndex", sdpMLineIndex },
                                  } },
                            });
                    },
                .connectionStateChanged =
                    [this](
                        const std::string& targetPeerId,
                        const poio::share::P2pConnectionState state,
                        const poio::share::P2pRoute route)
                    {
                        writer_.Event(
                            "p2p.connectionState",
                            {
                                { "peerId", targetPeerId },
                                { "state", P2pStateName(state) },
                                { "route", P2pRouteName(route) },
                            });
                    },
                .error =
                    [this](
                        const std::string& targetPeerId,
                        const std::string& error)
                    {
                        writer_.Event(
                            "p2p.error",
                            {
                                { "peerId", targetPeerId },
                                { "error", error },
                            });
                    },
            });
    }

    Json Stats() const
    {
        const auto stats = session_.stats();
        Json sfuStats = Json::array();
        try
        {
            sfuStats = Json::parse(stats.sfuStatsJson);
        }
        catch (...)
        {
        }
        return {
            { "running", session_.running() },
            { "producerId", session_.producerId() },
            { "p2pViewers", session_.p2pViewerCount() },
            { "capturedFrames", stats.capturedFrames },
            { "submittedFrames", stats.submittedFrames },
            { "pacedFrames", stats.pacedFrames },
            { "rejectedFrames", stats.rejectedFrames },
            { "width", stats.width },
            { "height", stats.height },
            { "sfuStats", std::move(sfuStats) },
        };
    }

    JsonWriter writer_;
    RequestBroker broker_;
    poio::share::NativeShareSession session_;
    std::thread worker_;
    std::mutex queueMutex_;
    std::condition_variable queueReady_;
    std::deque<Json> queue_;
    bool inputClosed_{ false };
};
} // namespace

int main()
{
    _setmode(_fileno(stdin), _O_BINARY);
    _setmode(_fileno(stdout), _O_BINARY);
    SetErrorMode(
        SEM_FAILCRITICALERRORS |
        SEM_NOGPFAULTERRORBOX |
        SEM_NOOPENFILEERRORBOX);
    StderrMediaSoupLogger mediaSoupLogger;
    if (DebugLoggingEnabled())
    {
        mediasoupclient::Logger::SetHandler(&mediaSoupLogger);
        mediasoupclient::Logger::SetLogLevel(
            mediasoupclient::Logger::LogLevel::LOG_DEBUG);
        webrtc::LogMessage::SetLogToStderr(true);
        webrtc::LogMessage::LogTimestamps();
        webrtc::LogMessage::LogThreads();
        webrtc::LogMessage::LogToDebug(webrtc::LS_INFO);
    }
    try
    {
        Sidecar sidecar;
        return sidecar.Run();
    }
    catch (const std::exception& error)
    {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
