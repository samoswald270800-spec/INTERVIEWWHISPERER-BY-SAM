# Whisper Virtual Camera

This directory contains the Windows-only native boundary for candidate video.
The Electron renderer copies decoded WebRTC `VideoFrame` planes without JPEG
re-encoding. `WhisperVirtualCameraBridge.exe` forwards only the latest frame to
the Media Foundation source over a secured named pipe, so network or consumer
backpressure drops frames instead of accumulating delay.

## Current components

- `bridge/main.cpp`: raw I420/NV12/RGBA frame bridge.
- `CMakeLists.txt`: MSVC build for the bridge executable.
- `frame-protocol.md`: binary packet contract shared with Electron.

## Required production component

Zoom and Teams will enumerate `Whisper Virtual Camera` only after a signed
Media Foundation virtual-camera source is implemented and installed. Use
Microsoft's `SimpleMediaSource` sample as the starting point. Its media stream
should connect to `\\.\pipe\WhisperVirtualCameraFrames`, convert incoming frames
to NV12/YUY2 as required, timestamp `IMFSample` objects from QPC, and hold the
latest frame when the network pauses.

After installation succeeds, the installer must write
`virtual-camera-installed.json` next to the bridge in the packaged resources.
The Electron UI intentionally remains disabled until both the bridge and this
installation marker are present.

## Build the bridge

```powershell
cmake -S native/windows-virtual-camera -B native/windows-virtual-camera/out -A x64
cmake --build native/windows-virtual-camera/out --config Release
```

Copy the resulting executable to:

`native/windows-virtual-camera/WhisperVirtualCameraBridge.exe`
