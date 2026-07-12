#include <windows.h>
#include <sddl.h>

#include "../include/frame_protocol.h"

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

using whisper::virtual_camera::FrameHeader;
using whisper::virtual_camera::IsValidFrameHeader;
using whisper::virtual_camera::kFramePipeName;
using whisper::virtual_camera::kMaxFrameBytes;

struct LatestFrame {
    FrameHeader header{};
    std::vector<std::uint8_t> bytes;
};

std::atomic<bool> gRunning{true};
std::mutex gFrameMutex;
std::condition_variable gFrameReady;
LatestFrame gLatestFrame;

bool ReadExact(HANDLE input, void* destination, std::size_t bytes) {
    auto* cursor = static_cast<std::uint8_t*>(destination);
    while (bytes > 0) {
        DWORD received = 0;
        const DWORD chunk = static_cast<DWORD>(std::min<std::size_t>(bytes, MAXDWORD));
        if (!ReadFile(input, cursor, chunk, &received, nullptr)) return false;
        if (received == 0) {
            SetLastError(ERROR_HANDLE_EOF);
            return false;
        }
        cursor += received;
        bytes -= received;
    }
    return true;
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
            kFramePipeName,
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
        LatestFrame frame;
        while (gRunning.load()) {
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

}  // namespace

int wmain(int argc, wchar_t* argv[]) {
    if (argc > 1 && std::wstring(argv[1]) == L"--status") {
        std::cout << R"({"bridgeReady":true,"driverInstalled":false})" << std::endl;
        return 0;
    }

    std::ios::sync_with_stdio(false);
    std::cin.tie(nullptr);

    const HANDLE input = GetStdHandle(STD_INPUT_HANDLE);
    if (!input || input == INVALID_HANDLE_VALUE) {
        std::cerr << "Standard input is unavailable" << std::endl;
        return 1;
    }

    std::thread pipeThread(PipeServer);
    std::cout << "READY" << std::endl;
    LatestFrame incoming;
    int exitCode = 0;
    while (gRunning.load()) {
        FrameHeader header{};
        if (!ReadExact(input, &header, sizeof(header))) {
            const DWORD error = GetLastError();
            if (error != ERROR_BROKEN_PIPE && error != ERROR_HANDLE_EOF) {
                std::cerr << "Could not read a complete frame header (Windows error "
                          << error << ")" << std::endl;
                exitCode = 2;
            }
            break;
        }
        if (!IsValidFrameHeader(header)) {
            std::cerr << "Invalid frame packet: magic=" << header.magic
                      << " version=" << header.version
                      << " headerSize=" << header.headerSize
                      << " format=" << header.format
                      << " width=" << header.width
                      << " height=" << header.height
                      << " dataSize=" << header.dataSize
                      << " planeCount=" << header.planeCount << std::endl;
            exitCode = 3;
            break;
        }

        incoming.header = header;
        incoming.bytes.resize(header.dataSize);
        if (!ReadExact(input, incoming.bytes.data(), incoming.bytes.size())) {
            std::cerr << "Frame payload ended before " << header.dataSize
                      << " bytes were received (Windows error " << GetLastError() << ")" << std::endl;
            exitCode = 4;
            break;
        }

        {
            std::lock_guard lock(gFrameMutex);
            gLatestFrame.header = incoming.header;
            gLatestFrame.bytes.swap(incoming.bytes);
        }
        gFrameReady.notify_one();
        std::cout << "FRAME " << header.sequence << ' '
                  << header.width << ' ' << header.height << std::endl;
    }

    gRunning.store(false);
    gFrameReady.notify_all();
    const HANDLE wakePipe = CreateFileW(
        kFramePipeName,
        GENERIC_READ,
        0,
        nullptr,
        OPEN_EXISTING,
        0,
        nullptr);
    if (wakePipe != INVALID_HANDLE_VALUE) CloseHandle(wakePipe);
    CancelSynchronousIo(pipeThread.native_handle());
    if (pipeThread.joinable()) pipeThread.join();
    return exitCode;
}
