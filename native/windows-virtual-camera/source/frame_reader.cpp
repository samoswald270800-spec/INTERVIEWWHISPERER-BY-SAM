#include "frame_reader.h"

#include <windows.h>

#include <algorithm>
#include <cstring>

namespace whisper::virtual_camera {
namespace {

bool ReadExact(HANDLE pipe, void* destination, std::size_t byteCount, const std::atomic<bool>& running) {
    auto* cursor = static_cast<std::uint8_t*>(destination);
    while (byteCount > 0 && running.load()) {
        DWORD bytesRead = 0;
        const DWORD chunk = static_cast<DWORD>(std::min<std::size_t>(byteCount, MAXDWORD));
        if (!ReadFile(pipe, cursor, chunk, &bytesRead, nullptr) || bytesRead == 0) return false;
        cursor += bytesRead;
        byteCount -= bytesRead;
    }
    return byteCount == 0;
}

bool PlaneFits(const FrameHeader& header, std::uint32_t plane, std::uint32_t rows, std::uint32_t rowBytes) {
    if (plane >= header.planeCount || rows == 0 || rowBytes == 0) return false;
    const auto& layout = header.planes[plane];
    if (layout.stride < rowBytes || layout.offset >= header.dataSize) return false;
    const std::uint64_t finalByte = static_cast<std::uint64_t>(layout.offset)
        + (static_cast<std::uint64_t>(rows - 1) * layout.stride)
        + rowBytes;
    return finalByte <= header.dataSize;
}

void CopyRows(
    std::uint8_t* destination,
    std::uint32_t destinationStride,
    const std::uint8_t* source,
    std::uint32_t sourceStride,
    std::uint32_t rowBytes,
    std::uint32_t rows) {
    for (std::uint32_t row = 0; row < rows; ++row) {
        std::memcpy(destination + (row * destinationStride), source + (row * sourceStride), rowBytes);
    }
}

bool ConvertToNv12(const FrameHeader& header, const std::vector<std::uint8_t>& source, Nv12Frame& destination) {
    if ((header.width & 1U) != 0 || (header.height & 1U) != 0) return false;
    const std::uint32_t width = header.width;
    const std::uint32_t height = header.height;
    const std::uint32_t chromaHeight = height / 2;
    const std::size_t yBytes = static_cast<std::size_t>(width) * height;
    const std::size_t requiredBytes = yBytes + (static_cast<std::size_t>(width) * chromaHeight);
    destination.bytes.resize(requiredBytes);

    if (!PlaneFits(header, 0, height, width)) return false;
    CopyRows(
        destination.bytes.data(),
        width,
        source.data() + header.planes[0].offset,
        header.planes[0].stride,
        width,
        height);

    auto* destinationUv = destination.bytes.data() + yBytes;
    if (header.format == kFormatNv12) {
        if (!PlaneFits(header, 1, chromaHeight, width)) return false;
        CopyRows(
            destinationUv,
            width,
            source.data() + header.planes[1].offset,
            header.planes[1].stride,
            width,
            chromaHeight);
    } else if (header.format == kFormatI420) {
        const std::uint32_t chromaWidth = width / 2;
        if (!PlaneFits(header, 1, chromaHeight, chromaWidth)
            || !PlaneFits(header, 2, chromaHeight, chromaWidth)) {
            return false;
        }
        const auto* sourceU = source.data() + header.planes[1].offset;
        const auto* sourceV = source.data() + header.planes[2].offset;
        for (std::uint32_t row = 0; row < chromaHeight; ++row) {
            auto* output = destinationUv + (row * width);
            const auto* inputU = sourceU + (row * header.planes[1].stride);
            const auto* inputV = sourceV + (row * header.planes[2].stride);
            for (std::uint32_t column = 0; column < chromaWidth; ++column) {
                output[column * 2] = inputU[column];
                output[(column * 2) + 1] = inputV[column];
            }
        }
    } else {
        return false;
    }

    destination.width = width;
    destination.height = height;
    destination.timestampUs = header.timestampUs;
    destination.sequence = header.sequence;
    return true;
}

}  // namespace

FrameReader::~FrameReader() {
    Stop();
}

void FrameReader::Start() {
    if (running_.exchange(true)) return;
    {
        std::lock_guard lock(latestMutex_);
        latest_ = {};
    }
    readThread_ = std::thread(&FrameReader::ReadLoop, this);
}

void FrameReader::Stop() {
    if (!running_.exchange(false)) return;
    if (readThread_.joinable()) {
        CancelSynchronousIo(readThread_.native_handle());
        readThread_.join();
    }
}

bool FrameReader::CopyLatest(Nv12Frame& destination) const {
    return CopyLatestAfter(0, destination);
}

bool FrameReader::CopyLatestAfter(std::uint64_t sequence, Nv12Frame& destination) const {
    std::lock_guard lock(latestMutex_);
    if (latest_.sequence == 0 || latest_.sequence == sequence || latest_.bytes.empty()) return false;
    destination = latest_;
    return true;
}

void FrameReader::ReadLoop() {
    std::vector<std::uint8_t> packetBytes;
    Nv12Frame converted;

    while (running_.load()) {
        HANDLE pipe = CreateFileW(
            kFramePipeName,
            GENERIC_READ,
            0,
            nullptr,
            OPEN_EXISTING,
            FILE_ATTRIBUTE_NORMAL,
            nullptr);
        if (pipe == INVALID_HANDLE_VALUE) {
            if (!WaitNamedPipeW(kFramePipeName, 500)) Sleep(100);
            continue;
        }

        while (running_.load()) {
            FrameHeader header{};
            if (!ReadExact(pipe, &header, sizeof(header), running_) || !IsValidFrameHeader(header)) break;
            packetBytes.resize(header.dataSize);
            if (!ReadExact(pipe, packetBytes.data(), packetBytes.size(), running_)) break;
            if (!ConvertToNv12(header, packetBytes, converted)) continue;

            {
                std::lock_guard lock(latestMutex_);
                latest_.width = converted.width;
                latest_.height = converted.height;
                latest_.timestampUs = converted.timestampUs;
                latest_.sequence = converted.sequence;
                latest_.bytes.swap(converted.bytes);
            }
        }

        CloseHandle(pipe);
    }
}

}  // namespace whisper::virtual_camera
