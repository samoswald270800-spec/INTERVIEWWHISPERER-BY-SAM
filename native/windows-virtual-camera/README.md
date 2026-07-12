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
- `source/virtual_camera_source.*`: 720p30 NV12 Media Foundation source and stream.
- `source/activation.cpp`: COM activation and self-registration entry points.
- `manager/main.cpp`: Windows 11 `MFCreateVirtualCamera` install/remove manager.
- `CMakeLists.txt`: MSVC builds for the bridge, manager, and source DLL.
- `frame-protocol.md`: binary packet contract shared with Electron.

The source advertises a fixed 1280x720 NV12 stream at 30 fps. It reads the
latest decoded candidate frame from `\\.\pipe\WhisperVirtualCameraFrames`,
converts I420 to NV12, scales adaptive WebRTC resolutions while preserving the
16:9 output, and repeats only the newest frame when the network pauses.

The manager uses `MFVirtualCameraLifetime_System` and
`MFVirtualCameraAccess_CurrentUser`, avoiding a kernel camera driver. It requires
Windows 11 build 22000 or later. The media-source COM DLL still must be installed
where the Local Service and Local System Frame Server processes can read it.
The Electron dashboard invokes the manager through a UAC prompt when the native
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

Also copy `WhisperVirtualCameraManager.exe` and
`WhisperVirtualCameraSource.dll` beside the bridge. Install or remove the camera
from an elevated PowerShell window:

```powershell
.\WhisperVirtualCameraManager.exe --install
.\WhisperVirtualCameraManager.exe --status
.\WhisperVirtualCameraManager.exe --remove
```
