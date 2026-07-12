# Whisper Windows audio bridge

This folder is the native landing zone for the Windows-only mock relay driver work.

The React app already separates the WebRTC audio lanes. The native bridge is responsible for one job only: take the superadmin return-audio lane from Whisper and feed it into a first-party Windows virtual microphone endpoint.

## Planned binaries

- `WhisperAudioBridge.exe`
  - Runs in user mode.
  - Owns the IPC connection from Electron.
  - Receives PCM packets for the superadmin relay microphone.
  - Writes packets into the driver transport.

- `WhisperVirtualMic.sys`
  - Windows audio endpoint driver based on Microsoft SysVAD.
  - Publishes `Whisper Virtual Microphone`.
  - Exposes a capture endpoint that Zoom, Teams, or another call app can select.

## Non-goals

- Do not mix the controlled machine microphone into the virtual microphone.
- Do not depend on VB-Cable, VoiceMeeter, OBS, or another third-party virtual audio app.
- Do not make the external call app install any separate relay client.

## First IPC contract

See `bridge-protocol.md` for the app/helper message contract.

Electron already exposes:

```js
window.electron.relayAudio.getStatus()
```

The current status call reports the intended device name and whether a bridge binary exists next to this folder. Start/stop and PCM packet streaming should be added after the native helper exists.
