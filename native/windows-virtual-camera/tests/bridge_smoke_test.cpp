#include <windows.h>

#include "../include/frame_protocol.h"

#include <algorithm>
#include <chrono>
#include <cstdint>
#include <iostream>
#include <string>
#include <vector>

namespace {

using whisper::virtual_camera::FrameHeader;
using whisper::virtual_camera::kFormatNv12;
using whisper::virtual_camera::kFrameMagic;
using whisper::virtual_camera::kFrameProtocolVersion;

constexpr std::uint32_t kWidth = 1280;
constexpr std::uint32_t kHeight = 720;
constexpr std::uint64_t kFrameDurationUs = 1'000'000ULL / 30ULL;
constexpr int kFrameCount = 60;

int Fail(const wchar_t* stage, DWORD error = GetLastError()) {
    std::wcerr << stage << L" failed with Windows error " << error << std::endl;
    return 1;
}

bool WriteExact(HANDLE output, const void* source, std::size_t bytes) {
    const auto* cursor = static_cast<const std::uint8_t*>(source);
    while (bytes > 0) {
        DWORD written = 0;
        const DWORD chunk = static_cast<DWORD>(std::min<std::size_t>(bytes, MAXDWORD));
        if (!WriteFile(output, cursor, chunk, &written, nullptr) || written == 0) return false;
        cursor += written;
        bytes -= written;
    }
    return true;
}

bool ReadLine(HANDLE input, std::string& line) {
    line.clear();
    for (;;) {
        char character = '\0';
        DWORD received = 0;
        if (!ReadFile(input, &character, 1, &received, nullptr) || received != 1) return false;
        if (character == '\n') return true;
        if (character != '\r') line.push_back(character);
        if (line.size() > 1024) return false;
    }
}

void StopChild(PROCESS_INFORMATION& process) {
    if (process.hProcess) {
        TerminateProcess(process.hProcess, 1);
        WaitForSingleObject(process.hProcess, 5000);
        CloseHandle(process.hProcess);
        process.hProcess = nullptr;
    }
    if (process.hThread) {
        CloseHandle(process.hThread);
        process.hThread = nullptr;
    }
}

}  // namespace

int wmain(int argc, wchar_t* argv[]) {
    if (argc != 2) return Fail(L"Usage", ERROR_INVALID_PARAMETER);

    SECURITY_ATTRIBUTES inheritable{sizeof(SECURITY_ATTRIBUTES), nullptr, TRUE};
    HANDLE childInputRead = nullptr;
    HANDLE parentInputWrite = nullptr;
    HANDLE parentOutputRead = nullptr;
    HANDLE childOutputWrite = nullptr;
    if (!CreatePipe(&childInputRead, &parentInputWrite, &inheritable, 0)
        || !CreatePipe(&parentOutputRead, &childOutputWrite, &inheritable, 0)) {
        return Fail(L"CreatePipe");
    }
    if (!SetHandleInformation(parentInputWrite, HANDLE_FLAG_INHERIT, 0)
        || !SetHandleInformation(parentOutputRead, HANDLE_FLAG_INHERIT, 0)) {
        return Fail(L"SetHandleInformation");
    }

    STARTUPINFOW startup{};
    startup.cb = sizeof(startup);
    startup.dwFlags = STARTF_USESTDHANDLES;
    startup.hStdInput = childInputRead;
    startup.hStdOutput = childOutputWrite;
    startup.hStdError = childOutputWrite;

    PROCESS_INFORMATION process{};
    std::wstring command = L"\"" + std::wstring(argv[1]) + L"\"";
    std::vector<wchar_t> commandBuffer(command.begin(), command.end());
    commandBuffer.push_back(L'\0');
    const BOOL created = CreateProcessW(
        nullptr,
        commandBuffer.data(),
        nullptr,
        nullptr,
        TRUE,
        CREATE_NO_WINDOW,
        nullptr,
        nullptr,
        &startup,
        &process);
    CloseHandle(childInputRead);
    CloseHandle(childOutputWrite);
    if (!created) {
        CloseHandle(parentInputWrite);
        CloseHandle(parentOutputRead);
        return Fail(L"CreateProcessW");
    }

    std::string line;
    if (!ReadLine(parentOutputRead, line) || line != "READY") {
        StopChild(process);
        CloseHandle(parentInputWrite);
        CloseHandle(parentOutputRead);
        return Fail(L"Bridge READY response", ERROR_INVALID_DATA);
    }

    const std::size_t lumaBytes = static_cast<std::size_t>(kWidth) * kHeight;
    std::vector<std::uint8_t> frame(lumaBytes * 3U / 2U, 128);
    std::fill(frame.begin(), frame.begin() + lumaBytes, static_cast<std::uint8_t>(16));
    const auto startedAt = std::chrono::steady_clock::now();
    for (int index = 1; index <= kFrameCount; ++index) {
        FrameHeader header{};
        header.magic = kFrameMagic;
        header.version = kFrameProtocolVersion;
        header.headerSize = sizeof(FrameHeader);
        header.format = kFormatNv12;
        header.width = kWidth;
        header.height = kHeight;
        header.timestampUs = static_cast<std::uint64_t>(index) * kFrameDurationUs;
        header.sequence = static_cast<std::uint64_t>(index);
        header.dataSize = static_cast<std::uint32_t>(frame.size());
        header.planeCount = 2;
        header.planes[0] = {0, kWidth};
        header.planes[1] = {static_cast<std::uint32_t>(lumaBytes), kWidth};

        if (!WriteExact(parentInputWrite, &header, sizeof(header))
            || !WriteExact(parentInputWrite, frame.data(), frame.size())) {
            StopChild(process);
            CloseHandle(parentInputWrite);
            CloseHandle(parentOutputRead);
            return Fail(L"Write frame");
        }

        const std::string expected = "FRAME " + std::to_string(index)
            + " " + std::to_string(kWidth) + " " + std::to_string(kHeight);
        if (!ReadLine(parentOutputRead, line) || line != expected) {
            StopChild(process);
            CloseHandle(parentInputWrite);
            CloseHandle(parentOutputRead);
            return Fail(L"Frame acknowledgement", ERROR_INVALID_DATA);
        }
    }
    const auto elapsed = std::chrono::steady_clock::now() - startedAt;
    CloseHandle(parentInputWrite);
    parentInputWrite = nullptr;

    if (WaitForSingleObject(process.hProcess, 5000) != WAIT_OBJECT_0) {
        StopChild(process);
        CloseHandle(parentOutputRead);
        return Fail(L"Bridge shutdown", ERROR_TIMEOUT);
    }
    DWORD exitCode = 1;
    GetExitCodeProcess(process.hProcess, &exitCode);
    CloseHandle(process.hProcess);
    CloseHandle(process.hThread);
    CloseHandle(parentOutputRead);
    if (exitCode != 0) return Fail(L"Bridge exit code", exitCode);
    if (elapsed > std::chrono::seconds(5)) return Fail(L"Bridge throughput", ERROR_TIMEOUT);

    const auto elapsedMilliseconds = std::chrono::duration_cast<std::chrono::milliseconds>(elapsed).count();
    std::wcout << L"Virtual camera bridge processed " << kFrameCount
               << L" 720p frames in " << elapsedMilliseconds << L" ms." << std::endl;
    return 0;
}
