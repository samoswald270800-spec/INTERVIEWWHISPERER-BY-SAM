#include <windows.h>
#include <sddl.h>

#include <atomic>
#include <algorithm>
#include <condition_variable>
#include <cstdint>
#include <iostream>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

namespace {

constexpr std::uint32_t FourCC(char a, char b, char c, char d) {
    return static_cast<std::uint32_t>(a)
        | (static_cast<std::uint32_t>(b) << 8)
        | (static_cast<std::uint32_t>(c) << 16)
        | (static_cast<std::uint32_t>(d) << 24);
}

constexpr std::uint32_t kMagic = FourCC('W', 'V', 'C', '1');
constexpr std::uint32_t kMaxFrameBytes = 16U * 1024U * 1024U;
constexpr wchar_t kPipeName[] = LR"(\\.\pipe\WhisperVirtualCameraFrames)";

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

static_assert(sizeof(FrameHeader) == 76, "Frame protocol must match electron-main.js");

struct LatestFrame {
    FrameHeader header{};
    std::vector<std::uint8_t> bytes;
};

std::atomic<bool> gRunning{true};
std::mutex gFrameMutex;
std::condition_variable gFrameReady;
LatestFrame gLatestFrame;

bool ReadExact(std::istream& input, void* destination, std::size_t bytes) {
    input.read(static_cast<char*>(destination), static_cast<std::streamsize>(bytes));
    return input.good() || input.gcount() == static_cast<std::streamsize>(bytes);
}

bool WriteExact(HANDLE pipe, const void* source, std::size_t bytes) {
    const auto* cursor = static_cast<const std::uint8_t*>(source);
    while (bytes > 0) {
        DWORD written = 0;
        const DWORD chunk = static_cast<DWORD>(std::min<std::size_t>(bytes, MAXDWORD));
        if (!WriteFile(pipe, cursor, chunk, &written, nullptr) || written == 0) return false;
        cursor += written;
        bytes -= written;
    }
    return true;
}

PSECURITY_DESCRIPTOR BuildPipeSecurityDescriptor() {
    HANDLE token = nullptr;
    if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token)) return nullptr;

    DWORD required = 0;
    GetTokenInformation(token, TokenUser, nullptr, 0, &required);
    std::vector<std::uint8_t> buffer(required);
    if (!GetTokenInformation(token, TokenUser, buffer.data(), required, &required)) {
        CloseHandle(token);
        return nullptr;
    }
    CloseHandle(token);

    const auto* tokenUser = reinterpret_cast<const TOKEN_USER*>(buffer.data());
    LPWSTR sidText = nullptr;
    if (!ConvertSidToStringSidW(tokenUser->User.Sid, &sidText)) return nullptr;

    const std::wstring sddl = L"D:P(A;;GA;;;SY)(A;;GR;;;LS)(A;;GR;;;" + std::wstring(sidText) + L")";
    LocalFree(sidText);

    PSECURITY_DESCRIPTOR descriptor = nullptr;
    if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(
            sddl.c_str(), SDDL_REVISION_1, &descriptor, nullptr)) {
        return nullptr;
    }
    return descriptor;
}

void PipeServer() {
    PSECURITY_DESCRIPTOR descriptor = BuildPipeSecurityDescriptor();
    SECURITY_ATTRIBUTES attributes{
        sizeof(SECURITY_ATTRIBUTES),
        descriptor,
        FALSE,
    };

    while (gRunning.load()) {
        HANDLE pipe = CreateNamedPipeW(
            kPipeName,
            PIPE_ACCESS_OUTBOUND,
            PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT,
            1,
            kMaxFrameBytes + sizeof(FrameHeader),
            0,
            1000,
            descriptor ? &attributes : nullptr);
        if (pipe == INVALID_HANDLE_VALUE) break;

        const BOOL connected = ConnectNamedPipe(pipe, nullptr)
            ? TRUE
            : (GetLastError() == ERROR_PIPE_CONNECTED);
        if (!connected) {
            CloseHandle(pipe);
            if (GetLastError() == ERROR_OPERATION_ABORTED) break;
            continue;
        }

        std::uint64_t lastSequence = 0;
        while (gRunning.load()) {
            LatestFrame frame;
            {
                std::unique_lock lock(gFrameMutex);
                gFrameReady.wait(lock, [&] {
                    return !gRunning.load() || gLatestFrame.header.sequence > lastSequence;
                });
                if (!gRunning.load()) break;
                frame = gLatestFrame;
            }

            if (!WriteExact(pipe, &frame.header, sizeof(frame.header))
                || !WriteExact(pipe, frame.bytes.data(), frame.bytes.size())) {
                break;
            }
            lastSequence = frame.header.sequence;
        }

        FlushFileBuffers(pipe);
        DisconnectNamedPipe(pipe);
        CloseHandle(pipe);
    }

    if (descriptor) LocalFree(descriptor);
}

bool IsSupportedFormat(std::uint32_t format) {
    return format == FourCC('I', '4', '2', '0')
        || format == FourCC('N', 'V', '1', '2')
        || format == FourCC('R', 'G', 'B', 'A')
        || format == FourCC('R', 'G', 'B', 'X')
        || format == FourCC('B', 'G', 'R', 'A')
        || format == FourCC('B', 'G', 'R', 'X');
}

}  // namespace

int wmain(int argc, wchar_t* argv[]) {
    if (argc > 1 && std::wstring(argv[1]) == L"--status") {
        std::cout << R"({"bridgeReady":true,"driverInstalled":false})" << std::endl;
        return 0;
    }

    std::ios::sync_with_stdio(false);
    std::cin.tie(nullptr);

    std::thread pipeThread(PipeServer);
    while (gRunning.load()) {
        FrameHeader header{};
        if (!ReadExact(std::cin, &header, sizeof(header))) break;
        if (header.magic != kMagic
            || header.version != 1
            || header.headerSize != sizeof(FrameHeader)
            || header.dataSize == 0
            || header.dataSize > kMaxFrameBytes
            || header.planeCount > 4
            || header.width < 2
            || header.height < 2
            || !IsSupportedFormat(header.format)) {
            std::cerr << "Invalid frame packet" << std::endl;
            break;
        }

        LatestFrame frame;
        frame.header = header;
        frame.bytes.resize(header.dataSize);
        if (!ReadExact(std::cin, frame.bytes.data(), frame.bytes.size())) break;

        {
            std::lock_guard lock(gFrameMutex);
            gLatestFrame = std::move(frame);
        }
        gFrameReady.notify_one();
    }

    gRunning.store(false);
    gFrameReady.notify_all();
    CancelSynchronousIo(pipeThread.native_handle());
    if (pipeThread.joinable()) pipeThread.join();
    return 0;
}
