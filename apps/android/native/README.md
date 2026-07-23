# POIO Android native voice

POIO Android uses the official `mumble-voip/libmumble` C++ core. It is not a
WebSocket voice imitation and it does not report a signalling-only session as
connected.

## Pinned upstreams

- `libmumble/`: `mumble-voip/libmumble` commit
  `4ce07284737cfc75ce2f1260ecd9ea3304055bd2`, BSD-3-Clause.
- Microsoft GSL v4.0.0 commit
  `a3534567187d2edc428efd3f13466ff75fe5805c`, MIT.
- QuickPool commit `ddc415bec1fc624e1c6b21c1b47063ca2eef84de`, MIT. The
  Android build disables its Linux-only `pthread_*affinity_np` calls because
  Bionic does not expose those non-portable functions.
- The libmumble vcpkg baseline is
  `215a2535590f1f63788ac9bd2ed58ad15e6afdff` and supplies the pinned Boost,
  OpenSSL, Opus and Protobuf builds.

The dependency-complete core is currently packaged for `arm64-v8a` as
`prebuilt/arm64-v8a/libmumble_library.so`. The APK intentionally ships only
that ABI so an unsupported device cannot open the UI and then fail voice.

## Implemented native path

`poio-mumble/src/PoioMumbleBridge.cpp` now provides:

1. official libmumble TCP/TLS connection, Version/Authenticate exchange,
   channel discovery and UserState channel movement;
2. CryptSetup handling and Mumble OCB2-encrypted UDP transport;
3. encrypted UDP ping confirmation, TCP heartbeat, ten-second UDP expiry and
   automatic TLS `UDPTunnel` fallback/recovery;
4. 48 kHz mono, 10 ms Opus VoIP frames with a small VAD hangover and proper
   talk-spurt terminators;
5. low-latency AAudio input/output, Android voice-communication presets,
   microphone level callbacks and bounded playback buffering;
6. per-Mumble-session decoders and local 0-200% user volume;
7. synchronous shutdown of Mumble, UDP, AAudio and JNI global references.

The Kotlin layer adds communication audio focus, Android 12+ communication
device selection and a microphone foreground service.

## Verification boundary

The arm64 library, JNI bridge, APK packaging, JVM unit tests and Android lint
all build successfully. A real two-device call is still a release gate. The
currently connected Rockchip Android 13 test device has a broken platform
package-verifier configuration (`Required verifier is null`) and stalls every
package commit even though the APK signature and integrity checks pass. Do not
call this release-ready until installation and the following device tests pass:

- Android to Windows bidirectional speech and mute/deafen/user-volume checks;
- speaker, earpiece, wired, USB and Bluetooth communication routes;
- echo, noise, jitter, packet loss and Wi-Fi/mobile-network handoff;
- background/lock-screen duration, interruption and resource cleanup.
