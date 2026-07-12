#pragma once

#include <cstdint>

namespace whisper::virtual_camera {

constexpr std::uint32_t FourCC(char a, char b, char c, char d) {
    return static_cast<std::uint32_t>(a)
        | (static_cast<std::uint32_t>(b) << 8)
        | (static_cast<std::uint32_t>(c) << 16)
        | (static_cast<std::uint32_t>(d) << 24);
}

constexpr std::uint32_t kFrameMagic = FourCC('W', 'V', 'C', '1');
constexpr std::uint16_t kFrameProtocolVersion = 1;
constexpr std::uint32_t kMaxFrameBytes = 16U * 1024U * 1024U;
constexpr wchar_t kFramePipeName[] = LR"(\\.\pipe\WhisperVirtualCameraFrames)";

constexpr std::uint32_t kFormatI420 = FourCC('I', '4', '2', '0');
constexpr std::uint32_t kFormatNv12 = FourCC('N', 'V', '1', '2');
constexpr std::uint32_t kFormatRgba = FourCC('R', 'G', 'B', 'A');
constexpr std::uint32_t kFormatRgbx = FourCC('R', 'G', 'B', 'X');
constexpr std::uint32_t kFormatBgra = FourCC('B', 'G', 'R', 'A');
constexpr std::uint32_t kFormatBgrx = FourCC('B', 'G', 'R', 'X');

#pragma pack(push, 1)
struct PlaneLayout {
    std::uint32_t offset;
    std::uint32_t stride;
};

struct FrameHeader {
    std::uint32_t magic;
    std::uint16_t version;
    std::uint16_t headerSize;
    std::uint32_t format;
    std::uint32_t width;
    std::uint32_t height;
    std::uint64_t timestampUs;
    std::uint64_t sequence;
    std::uint32_t dataSize;
    std::uint32_t planeCount;
    PlaneLayout planes[4];
};
#pragma pack(pop)

static_assert(sizeof(FrameHeader) == 76, "Frame protocol header size changed");

constexpr bool IsSupportedTransportFormat(std::uint32_t format) {
    return format == kFormatI420
        || format == kFormatNv12
        || format == kFormatRgba
        || format == kFormatRgbx
        || format == kFormatBgra
        || format == kFormatBgrx;
}

constexpr bool IsValidFrameHeader(const FrameHeader& header) {
    return header.magic == kFrameMagic
        && header.version == kFrameProtocolVersion
        && header.headerSize == sizeof(FrameHeader)
        && header.dataSize > 0
        && header.dataSize <= kMaxFrameBytes
        && header.planeCount <= 4
        && header.width >= 2
        && header.height >= 2
        && IsSupportedTransportFormat(header.format);
}

}  // namespace whisper::virtual_camera
