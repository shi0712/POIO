# POIO Share Core

`poio-share-core` is the isolated Windows-native screen-sharing core under development for POIO. It does not
replace the current Electron/WebRTC sharing path yet.

The first milestone provides:

- Windows Graphics Capture capability detection.
- DXGI GPU and output enumeration.
- Display and top-level window source enumeration.
- Media Foundation hardware H.264 encoder enumeration for NV12/ARGB32 input.
- A stable UTF-8 JSON diagnostics schema (`poio.share.probe.v1`).
- A real Windows Graphics Capture to D3D11 texture benchmark (`poio.share.capture-benchmark.v1`).
- A Media Foundation hardware H.264 GPU-surface encode benchmark (`poio.share.encode-benchmark.v1`).
- A reusable hardware encoder session with encoded access-unit callbacks, live bitrate control and key-frame requests.
- A standalone lab executable so native work can be tested before POIO integration.

## Build

From a normal PowerShell window, run:

```powershell
native\share-core\build.cmd
```

The script locates Visual Studio 2022 Build Tools and its bundled CMake/Ninja, configures an x64 release-with-debug-info
build, compiles it, and runs CTest.

## Run

```powershell
native/share-core/build/poio-share-lab.exe probe --json
native/share-core/build/poio-share-lab.exe adapters --json
native/share-core/build/poio-share-lab.exe encoders --json
native/share-core/build/poio-share-lab.exe sources --json
native/share-core/build/poio-share-lab.exe benchmark "monitor:\\.\DISPLAY1" --frames 120
native/share-core/build/poio-share-lab.exe encode-benchmark "monitor:\\.\DISPLAY1" --frames 180 --fps 60 --bitrate-mbps 12
native/share-core/build/poio-share-lab.exe encode-benchmark synthetic:motion --frames 180 --fps 60 --bitrate-mbps 20
native/share-core/build/poio-share-lab.exe encode-benchmark synthetic:motion --frames 180 --fps 60 --bitrate-mbps 12 --profile baseline
```

The benchmark consumes native D3D11 textures without copying frames through system memory. It reports first-frame
latency, measured FPS, average/p95/max frame interval and estimated dropped frames. The next milestone will connect
the encoded H.264 access units to the WebRTC transport and add DXGI Desktop Duplication as the capture fallback.
Capture and encode run on separate threads with a one-frame latest-only queue, so temporary encoder or transport
backpressure discards stale frames instead of building latency.
The `synthetic:motion` source renders a deterministic, high-motion D3D11 stress pattern directly on the GPU. It is
used to verify frame rate and bitrate behavior without relying on how much the desktop happens to change.
Every encode benchmark also validates the transport-facing callback: each Annex-B access unit must have non-empty
bytes, monotonic frame/timing metadata and key-frame accounting consistent with the encoder statistics.
The optional profile check validates the SPS emitted by the actual hardware MFT. The live WebRTC transport uses
constrained baseline (`profile-level-id=42e01f`) to match the POIO mediasoup router.

## Optional native WebRTC dependency

The transport integration targets the official `libmediasoupclient` v3 API and WebRTC m140. The dependency checkout
and build stay under the ignored `.tooling` directory:

```powershell
native\share-core\scripts\build-libwebrtc.cmd
```

The script follows the official WebRTC/Chromium Windows flow: depot_tools, `fetch webrtc`, branch-heads/7339,
`gclient sync`, GN and autoninja. It enables H.264 and RTTI while producing an optimized non-component x64 static
library. This dependency is intentionally optional so the capture/encoder lab remains fast to build and test.

After the dependency is available, build and type-check the native WebRTC
adapter in its own CMake directory:

```powershell
native\share-core\build-webrtc.cmd
```

The adapter supplies a GPU-native `VideoTrackSource`, a Media Foundation H.264
`VideoEncoderFactory`, and an owned WebRTC runtime with separate
network/worker/signaling threads. Encoded access units are moved into WebRTC
without a second bitstream copy. WebRTC remains responsible for
ICE/DTLS/SRTP, RTP/RTCP, congestion control, retransmission and receiver
key-frame feedback.
The first native SFU boundary is implemented by `SfuPublisher`. It loads the
router RTP capabilities, creates a `libmediasoupclient` send transport with the
custom WebRTC factory, publishes the GPU-native video track, and forwards DTLS
and `produce` requests through asynchronous callbacks. This keeps Socket.IO and
authentication in Electron while ICE, DTLS, SRTP, RTP, RTCP, NACK and congestion
control remain in WebRTC.
The same runtime now includes `P2pPublisher`: one send-only PeerConnection per
direct viewer, using the shared D3D11-backed video track, H.264 hardware
encoding, trickle ICE, direct-candidate preference, TURN fallback, congestion
control and explicit per-viewer bitrate/frame-rate limits. SDP is emitted only
after the local description is installed, while early local and remote ICE
candidates are bounded and queued safely.

`NativeShareSession` owns the complete publisher lifetime and enforces safe
shutdown ordering across capture callbacks, the native video source, WebRTC
threads, direct P2P viewers and the mediasoup producer. A single WGC capture
source feeds both routes so a direct viewer can avoid the server bandwidth
bottleneck while the SFU remains available for incompatible or excess viewers.
Captured, submitted and rejected frame counters are exposed for the later
Electron diagnostics overlay.

Build WebRTC plus the native mediasoup publisher:

```bat
native\share-core\build-mediasoup.cmd
```

That build also creates `poio-share-sidecar.exe`. It uses newline-delimited
UTF-8 JSON (`poio.share.ipc.v1`) over standard input/output. Commands are
serialized on a worker thread, while a dedicated input reader resolves
`sfu.connectTransport` and `sfu.produce` requests even when
libmediasoupclient is synchronously waiting for signaling. The sidecar exposes
`hello`, `probe`, `sources`, `start`, `stop`, `stats`, `sfu.setPaused`, `p2p.addViewer`,
`p2p.answer`, `p2p.candidate`, `p2p.removeViewer` and `shutdown`. This boundary
keeps tokens and Socket.IO in Electron and avoids loading Chromium capture or
encoding into the native transport.

Before producing a Windows installer, the desktop package runs
`scripts/stage-desktop.ps1`. It rebuilds the sidecar, copies the single
statically linked executable into Electron's `extraResources`, and stages the
libwebrtc, libmediasoupclient and libsdptransform licenses. The executable is
about 29 MB and depends only on Windows system multimedia/network libraries;
there is no extra Visual C++ runtime DLL bundle.

Run a real sidecar lifecycle smoke test after building:

```powershell
node native/share-core/scripts/sidecar-smoke.mjs
```

The smoke test captures the primary monitor, creates a native H.264 mediasoup
producer through the NDJSON signaling boundary, verifies live frame counters,
pauses and resumes the SFU producer, then confirms a clean stop and shutdown.
