# Windows mock interview audio relay

This document tracks the Windows-only relay mode for supervised mock interview training.

## Goal

The app needs three separate audio paths:

1. Controlled machine system audio, including Zoom or Teams interviewer audio, goes to the superadmin through the existing WebRTC screen stream.
2. Controlled machine microphone audio goes to the superadmin as a separate WebRTC audio-only stream.
3. Superadmin microphone audio goes back to the controlled machine and later feeds a first-party Windows virtual microphone named `Whisper Virtual Microphone`.

The virtual microphone must only carry the superadmin relay audio. It must not mix in the controlled machine microphone. That keeps the external call app from hearing the controlled machine microphone through this relay path.

## Current implementation

The React/Electron app now has the application-level WebRTC relay lanes:

- Candidate side captures screen/system audio with `getDisplayMedia`.
- Candidate side captures local microphone with `getUserMedia` and sends it as a separate audio-only WebRTC stream.
- Superadmin side receives and controls system audio and candidate microphone playback independently.
- Superadmin side can enable or disable return microphone relay.
- Candidate side receives the superadmin return-audio stream and plays it locally.

This is enough to prove the lane separation in Whisper itself. It does not yet make Zoom or Teams receive the superadmin voice as a microphone input.

## Native Windows bridge

To make Zoom or Teams hear the superadmin voice, Whisper needs to ship these first-party Windows pieces:

- `WhisperAudioBridge.exe`: a user-mode helper launched by Electron.
- `Whisper Virtual Microphone`: a signed Windows audio endpoint driver.
- Shared PCM transport between the helper and the driver.
- Electron IPC controls for status, start, stop, and level telemetry.

The driver should be based on the Microsoft SysVAD virtual audio sample:

- https://github.com/microsoft/Windows-driver-samples/tree/main/audio/sysvad
- https://learn.microsoft.com/windows-hardware/drivers/audio/
- https://learn.microsoft.com/windows-hardware/drivers/install/kernel-mode-code-signing-requirements--windows-vista-and-later-

## Audio format

Default transport format:

- 48 kHz
- stereo float32 PCM for app-to-helper
- mono or stereo PCM accepted by the virtual microphone endpoint
- 10 ms packets preferred for low latency

## Product behavior

In mock training relay mode:

- The candidate chooses `Whisper Virtual Microphone` in Zoom or Teams.
- The candidate keeps their real microphone available to Whisper for training supervision.
- The superadmin hears both remote system audio and the candidate microphone in Whisper.
- Zoom or Teams receives only the superadmin relay audio from the virtual microphone device.

## Remaining native work

1. Create the WDK driver project from SysVAD and rename the endpoint to `Whisper Virtual Microphone`.
2. Add a kernel/user transport for PCM from `WhisperAudioBridge.exe` into the render/capture pin used by the virtual endpoint.
3. Build the helper in C++ or Rust and expose a local named pipe or localhost IPC protocol.
4. Sign the driver for development with test signing, then for production with Microsoft attestation or WHQL signing.
5. Add installer steps that install/uninstall the driver and verify the endpoint exists before relay mode is marked ready.
