#include "poio/share/p2p.hpp"
#include "poio/share/webrtc.hpp"

#include <d3d11.h>
#include <wrl/client.h>

#include <chrono>
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
    Expect(
        SUCCEEDED(deviceResult) && device != nullptr,
        "D3D11 hardware device is created");
    if (!device)
    {
        return 1;
    }

    try
    {
        poio::share::NativeVideoSource source;
        poio::share::WebRtcRuntime runtime(device.Get(), "test-adapter");
        const auto track =
            runtime.CreateVideoTrack(source, "poio-native-p2p-test");
        Expect(track != nullptr, "native P2P test track is created");

        poio::share::P2pPublisher publisher(runtime.factory());
        std::promise<std::string> offerResult;
        auto offerFuture = offerResult.get_future();
        std::promise<std::string> errorResult;
        auto errorFuture = errorResult.get_future();

        publisher.AddViewer(
            "viewer-a",
            track,
            {
                .minBitrateBps = 1'000'000,
                .maxBitrateBps = 18'000'000,
                .maxFrameRate = 60.0,
                .maximumPeers = 2,
            },
            {
                .localDescription =
                    [&offerResult](
                        const std::string&,
                        const std::string& type,
                        const std::string& sdp)
                    {
                        if (type == "offer")
                        {
                            try
                            {
                                offerResult.set_value(sdp);
                            }
                            catch (...)
                            {
                            }
                        }
                    },
                .localCandidate =
                    [](const std::string&,
                       const std::string&,
                       int,
                       const std::string&)
                    {
                    },
                .error =
                    [&errorResult](
                        const std::string&,
                        const std::string& error)
                    {
                        try
                        {
                            errorResult.set_value(error);
                        }
                        catch (...)
                        {
                        }
                    },
            });
        Expect(publisher.ViewerCount() == 1, "P2P viewer is retained");
        Expect(publisher.HasViewer("viewer-a"), "P2P viewer can be queried");

        const auto offerStatus =
            offerFuture.wait_for(std::chrono::seconds(10));
        Expect(
            offerStatus == std::future_status::ready,
            "native P2P offer is produced asynchronously");
        if (offerStatus == std::future_status::ready)
        {
            const std::string offer = offerFuture.get();
            Expect(
                offer.find("m=video") != std::string::npos,
                "P2P offer contains a video media section");
            Expect(
                offer.find("a=sendonly") != std::string::npos,
                "P2P offer is send-only");
            Expect(
                offer.find("H264/90000") != std::string::npos,
                "P2P offer advertises H.264");
            Expect(
                offer.find("profile-level-id=42e01f") != std::string::npos,
                "P2P offer advertises constrained baseline");
        }
        Expect(
            errorFuture.wait_for(std::chrono::milliseconds(50)) ==
                std::future_status::timeout,
            "valid P2P offer generation reports no error");

        bool duplicateRejected = false;
        try
        {
            publisher.AddViewer(
                "viewer-a",
                track,
                {},
                {
                    .localDescription =
                        [](const std::string&,
                           const std::string&,
                           const std::string&)
                        {
                        },
                    .localCandidate =
                        [](const std::string&,
                           const std::string&,
                           int,
                           const std::string&)
                        {
                        },
                });
        }
        catch (const std::logic_error&)
        {
            duplicateRejected = true;
        }
        Expect(duplicateRejected, "duplicate P2P viewer is rejected");

        publisher.RemoveViewer("viewer-a");
        Expect(publisher.ViewerCount() == 0, "P2P viewer closes cleanly");
        publisher.Close();
    }
    catch (const std::exception& error)
    {
        std::cerr << "FAILED: native P2P test threw: " << error.what() << '\n';
        ++failures;
    }

    if (failures == 0)
    {
        std::cout << "All POIO native P2P tests passed\n";
    }
    return failures == 0 ? 0 : 1;
}
