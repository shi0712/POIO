#include "poio/share/session.hpp"
#include "poio/share/sfu.hpp"
#include "poio/share/webrtc.hpp"

#include <d3d11.h>
#include <wrl/client.h>

#include <future>
#include <iostream>
#include <iterator>
#include <stdexcept>
#include <string>

namespace
{
int failures = 0;

void Expect(const bool condition, const std::string& message)
{
    if (!condition)
    {
        std::cerr << "FAILED: " << message << '\n';
        ++failures;
    }
}

constexpr char kRouterCapabilities[] = R"({
  "codecs": [
    {
      "kind": "video",
      "mimeType": "video/H264",
      "preferredPayloadType": 103,
      "clockRate": 90000,
      "parameters": {
        "packetization-mode": 1,
        "level-asymmetry-allowed": 1,
        "profile-level-id": "42e01f"
      },
      "rtcpFeedback": [
        {"type": "nack"},
        {"type": "nack", "parameter": "pli"},
        {"type": "ccm", "parameter": "fir"},
        {"type": "goog-remb"},
        {"type": "transport-cc"}
      ]
    },
    {
      "kind": "video",
      "mimeType": "video/rtx",
      "preferredPayloadType": 104,
      "clockRate": 90000,
      "parameters": {"apt": 103},
      "rtcpFeedback": []
    }
  ],
  "headerExtensions": []
})";

poio::share::SfuTransportDescription TestTransport()
{
    return {
        .id = "poio-test-transport",
        .iceParametersJson = R"({
          "iceLite": true,
          "usernameFragment": "poiotest",
          "password": "poio-test-password-123456789"
        })",
        .iceCandidatesJson = R"([
          {
            "foundation": "poio",
            "priority": 1078862079,
            "ip": "127.0.0.1",
            "protocol": "udp",
            "port": 49000,
            "type": "host"
          }
        ])",
        .dtlsParametersJson = R"({
          "role": "auto",
          "fingerprints": [
            {
              "algorithm": "sha-256",
              "value": "A9:F4:E0:D2:74:D3:0F:D9:CA:A5:2F:9F:7F:47:FA:F0:C4:72:DD:73:49:D0:3B:14:90:20:51:30:1B:90:8E:71"
            }
          ]
        })",
    };
}
} // namespace

int main()
{
    Microsoft::WRL::ComPtr<ID3D11Device> device;
    Microsoft::WRL::ComPtr<ID3D11DeviceContext> context;
    D3D_FEATURE_LEVEL selectedFeatureLevel{};
    const D3D_FEATURE_LEVEL featureLevels[]{
        D3D_FEATURE_LEVEL_12_1,
        D3D_FEATURE_LEVEL_12_0,
        D3D_FEATURE_LEVEL_11_1,
        D3D_FEATURE_LEVEL_11_0,
    };
    const HRESULT deviceResult = D3D11CreateDevice(
        nullptr,
        D3D_DRIVER_TYPE_HARDWARE,
        nullptr,
        D3D11_CREATE_DEVICE_BGRA_SUPPORT | D3D11_CREATE_DEVICE_VIDEO_SUPPORT,
        featureLevels,
        static_cast<UINT>(std::size(featureLevels)),
        D3D11_SDK_VERSION,
        &device,
        &selectedFeatureLevel,
        &context);
    Expect(SUCCEEDED(deviceResult) && device != nullptr, "D3D11 hardware device is created");
    if (!device)
    {
        return 1;
    }

    try
    {
        poio::share::WebRtcRuntime runtime(device.Get(), "test-adapter");
        poio::share::SfuPublisher publisher;
        Expect(!publisher.IsOpen(), "SFU publisher starts closed");
        Expect(!publisher.IsPublishing(), "SFU publisher starts idle");

        publisher.Open(
            kRouterCapabilities,
            TestTransport(),
            runtime.factory().get(),
            {
                .connectTransport =
                    [](const std::string&, const std::string&)
                    {
                        std::promise<void> result;
                        result.set_value();
                        return result.get_future();
                    },
                .produce =
                    [](const std::string&,
                       const std::string&,
                       const std::string&,
                       const std::string&)
                    {
                        std::promise<std::string> result;
                        result.set_value("poio-test-producer");
                        return result.get_future();
                    },
            });
        Expect(publisher.IsOpen(), "libmediasoupclient send transport opens");
        Expect(!publisher.IsPublishing(), "transport opens without publishing media");
        publisher.Close();
        Expect(!publisher.IsOpen(), "SFU publisher closes cleanly");

        poio::share::NativeShareSession session;
        Expect(!session.running(), "full native share session starts stopped");
        const auto stats = session.stats();
        Expect(
            stats.capturedFrames == 0 &&
                stats.submittedFrames == 0 &&
                stats.pacedFrames == 0 &&
                stats.rejectedFrames == 0,
            "full native share session starts with empty counters");
        Expect(
            session.p2pViewerCount() == 0,
            "full native share session starts without P2P viewers");
        session.Stop();
    }
    catch (const std::exception& error)
    {
        std::cerr << "FAILED: native SFU test threw: " << error.what() << '\n';
        ++failures;
    }

    if (failures == 0)
    {
        std::cout << "All POIO native SFU tests passed\n";
    }
    return failures == 0 ? 0 : 1;
}
