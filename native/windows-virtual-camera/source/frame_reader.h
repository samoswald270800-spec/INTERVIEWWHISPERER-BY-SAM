#pragma once

#include "../include/frame_protocol.h"

#include <atomic>
#include <cstdint>
#include <mutex>
#include <thread>
#include <vector>

namespace whisper::virtual_camera {

struct Nv12Frame {
    std::uint32_t width = 0;
    std::uint32_t height = 0;
    std::uint64_t timestampUs = 0;
    std::uint64_t sequence = 0;
    std::vector<std::uint8_t> bytes;
};

class FrameReader final {
public:
    FrameReader() = default;
    ~FrameReader();

    FrameReader(const FrameReader&) = delete;
    FrameReader& operator=(const FrameReader&) = delete;

    void Start();
    void Stop();
    bool CopyLatest(Nv12Frame& destination) const;
    bool CopyLatestAfter(std::uint64_t sequence, Nv12Frame& destination) const;

private:
    void ReadLoop();

    std::atomic<bool> running_{false};
    std::thread readThread_;
    mutable std::mutex latestMutex_;
    Nv12Frame latest_;
};

}  // namespace whisper::virtual_camera
