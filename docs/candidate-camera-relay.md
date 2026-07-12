# Candidate camera relay

This Windows-first workflow lets a superadmin create a short-lived browser link.
The candidate opens the link, grants camera and microphone permission, and
publishes directly to the superadmin over WebRTC. The candidate does not need an
account, desktop installation, Zoom, Teams, or OBS.

Use this only for disclosed mock interviews and training sessions where every
participant has consented to the relayed media and participant presentation.

## Media directions

| Source | Destination |
| --- | --- |
| Candidate camera | Superadmin preview and Whisper Virtual Camera |
| Candidate microphone | Superadmin monitor only |
| Superadmin microphone | Candidate browser when call-audio relay is enabled |
| Superadmin system audio | Candidate browser when call-audio relay is enabled |

Candidate microphone tracks are never sent to the virtual-camera bridge or an
outbound Zoom/Teams audio device.

## Security model

- Only an authenticated `super_admin` can create a camera link.
- Tokens contain 256 bits of randomness and expire after 30 minutes by default.
- Redis stores only SHA-256 token hashes.
- The first browser identity to open a link claims it; another browser is rejected.
- Creating a new link immediately revokes the previous link for that superadmin.
- Leaving ends and revokes the link. An unexpected network drop has a 15-second
  reconnect grace period, after which the link is permanently invalid.
- Guest sockets use the isolated `/camera` namespace and cannot register remote-
  control or admin event handlers.
- The camera page sends `no-referrer`, `no-store`, and restrictive media
  permission headers so the token is not disclosed to page dependencies.

Set `CAMERA_SESSION_TTL_SECONDS` to a value from 300 through 7200 to override
the default expiration.

## Video quality

- Capture target: 1280x720 at 30 fps, with a 24 fps floor when supported.
- Sender ceiling: 2.8 Mbps, adapting to 2.2 or 1.8 Mbps under loss/latency pressure.
- H.264 is preferred when both peers support it, with VP8/VP9/AV1 available as fallbacks.
- Receiver jitter targets are 60-75 ms to balance smooth playback and call latency.
- The dashboard reports received/source FPS so capture, CPU, and network limits are distinguishable.
- Transport: direct WebRTC when possible, TURN relay when required.
- Native handoff: decoded `VideoFrame` planes, preferably NV12, without JPEG
  re-encoding.
- Backpressure: drop frames rather than queueing them and increasing latency.

Production deployments need a TURN service configured through
`WEBRTC_ICE_SERVERS` or `TURN_URL`, `TURN_USERNAME`, and `TURN_CREDENTIAL`.

## Windows virtual camera

The Electron frame pump and native named-pipe bridge are present under
`native/windows-virtual-camera`. A production Windows installer still needs the
signed Media Foundation source/driver package based on Microsoft's
`SimpleMediaSource` sample. The source must consume the bridge protocol and
expose NV12 and YUY2 media types. Until that signed component is installed, the
dashboard deliberately shows `Native component required` rather than claiming
that Zoom or Teams can enumerate the camera.

## Verification matrix

1. Candidate Chrome and Edge on Windows and macOS.
2. Candidate Chrome and Safari on Android and iOS.
3. Superadmin desktop app on Windows 11 build 22000 or later.
4. Windows Camera application enumeration and 30-minute continuous playback.
5. Zoom and Teams at 720p with reconnect, mute, camera-off, and network-loss tests.
6. Restrictive NAT test through the production TURN service.
