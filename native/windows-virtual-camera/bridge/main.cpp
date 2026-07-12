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

    std::thread pipeThread(PipeServer);
    LatestFrame incoming;
    while (gRunning.load()) {
        FrameHeader header{};
        if (!ReadExact(std::cin, &header, sizeof(header))) break;
        if (!IsValidFrameHeader(header)) {
            std::cerr << "Invalid frame packet" << std::endl;
            break;
        }

        incoming.header = header;
        incoming.bytes.resize(header.dataSize);
        if (!ReadExact(std::cin, incoming.bytes.data(), incoming.bytes.size())) break;

        {
            std::lock_guard lock(gFrameMutex);
            gLatestFrame.header = incoming.header;
            gLatestFrame.bytes.swap(incoming.bytes);
        }
        gFrameReady.notify_one();
    }

    gRunning.store(false);
    gFrameReady.notify_all();
    CancelSynchronousIo(pipeThread.native_handle());
    if (pipeThread.joinable()) pipeThread.join();
    return 0;
}
