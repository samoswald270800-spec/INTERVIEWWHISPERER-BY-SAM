# Frame protocol

Electron writes a packed 76-byte little-endian header followed immediately by
the decoded frame planes. The bridge forwards the same packet over
`\\.\pipe\WhisperVirtualCameraFrames`.

| Offset | Type | Field |
| ---: | --- | --- |
| 0 | uint32 | `WVC1` magic |
| 4 | uint16 | version (`1`) |
| 6 | uint16 | header size (`76`) |
| 8 | uint32 | FourCC (`I420`, `NV12`, `RGBA`, `RGBX`, `BGRA`, `BGRX`) |
| 12 | uint32 | display width |
| 16 | uint32 | display height |
| 20 | uint64 | WebCodecs timestamp in microseconds |
| 28 | uint64 | monotonic frame sequence |
| 36 | uint32 | payload byte count |
| 40 | uint32 | plane count, maximum four |
| 44 | 4 x pair<uint32> | plane offset and stride |

The bridge allows one Media Foundation consumer and keeps only the latest
frame. Candidate microphone data never enters this protocol.
