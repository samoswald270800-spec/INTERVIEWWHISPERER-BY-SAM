# Whisper audio bridge protocol

This is the first contract between Electron and `WhisperAudioBridge.exe`.

## Status

Request:

```json
{ "type": "status" }
```

Response:

```json
{
  "type": "status",
  "supported": true,
  "driverInstalled": false,
  "bridgeReady": true,
  "deviceName": "Whisper Virtual Microphone",
  "sampleRate": 48000,
  "channels": 2
}
```

## Start

Request:

```json
{
  "type": "start",
  "format": {
    "sampleRate": 48000,
    "channels": 2,
    "sampleFormat": "float32",
    "packetMs": 10
  }
}
```

Response:

```json
{ "type": "started" }
```

## Audio packet

Request:

```json
{
  "type": "audio",
  "sequence": 1,
  "timestampMs": 0,
  "pcmBase64": "..."
}
```

The packet contains only superadmin relay microphone PCM. Candidate microphone PCM must never be sent on this channel.

## Stop

Request:

```json
{ "type": "stop" }
```

Response:

```json
{ "type": "stopped" }
```
