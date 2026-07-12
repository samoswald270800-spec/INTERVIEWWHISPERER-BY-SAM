# Whisper Virtual Camera

This directory contains the Windows-only native boundary for candidate video.
The Electron renderer copies decoded WebRTC `VideoFrame` planes without JPEG
re-encoding. `WhisperVirtualCameraBridge.exe` forwards only the latest frame to
the Media Foundation source over a secured named pipe, so network or consumer
backpressure drops frames instead of accumulating delay.

## Current components

- `bridge/main.cpp`: raw I420/NV12/RGBA frame bridge.
- `include/frame_protocol.h`: shared, validated frame packet definition.
- `source/frame_reader.*`: Frame Server-side pipe reader and I420-to-NV12 converter.
- `manager/main.cpp`: Windows 11 `MFCreateVirtualCamera` install/remove manager.
- `CMakeLists.txt`: MSVC builds for the bridge and manager executables.
- `frame-protocol.md`: binary packet contract shared with Electron.

## Required production component

Zoom and Teams will enumerate `Whisper Virtual Camera` only after a signed
Media Foundation virtual-camera source is implemented and installed. Use
Microsoft's MIT-licensed `Windows-Camera` `SimpleMediaSource` sample as the
starting point. Its media stream
should connect to `\\.\pipe\WhisperVirtualCameraFrames`, convert incoming frames
to NV12/YUY2 as required, timestamp `IMFSample` objects from QPC, and hold the
latest frame when the network pauses.

The manager uses `MFVirtualCameraLifetime_System` and
`MFVirtualCameraAccess_CurrentUser`, avoiding a kernel camera driver. It requires
Windows 11 build 22000 or later. The media-source COM DLL still must be installed
where the Local Service and Local System Frame Server processes can read it.
The Electron dashboard invokes the manager through a UAC prompt when all signed
components are bundled, so end users do not operate the manager separately.

After installation succeeds, the manager copies the signed source and writes
`virtual-camera-installed.json` under
`%ProgramData%\InterviewWhisperer\VirtualCamera`. The Electron UI intentionally
remains disabled until the bundled bridge/source and this machine-readable
installation marker are present.

## Build the bridge

```powershell
cmake -S native/windows-virtual-camera -B native/windows-virtual-camera/out -A x64
cmake --build native/windows-virtual-camera/out --config Release
```

Copy the resulting executable to:

`native/windows-virtual-camera/WhisperVirtualCameraBridge.exe`

Also copy `WhisperVirtualCameraManager.exe` beside the bridge. Once the signed
`WhisperVirtualCameraSource.dll` exists in that directory, install or remove the
camera from an elevated PowerShell window:

```powershell
.\WhisperVirtualCameraManager.exe --install
.\WhisperVirtualCameraManager.exe --status
.\WhisperVirtualCameraManager.exe --remove
```
