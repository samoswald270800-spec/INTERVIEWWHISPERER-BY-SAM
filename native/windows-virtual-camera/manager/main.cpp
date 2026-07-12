#include <windows.h>
#include <mfapi.h>
#include <mfvirtualcamera.h>
#include <wrl/client.h>

#include <chrono>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <sstream>
#include <string>
#include <string_view>

namespace {

using Microsoft::WRL::ComPtr;

constexpr wchar_t kFriendlyName[] = L"Whisper Virtual Camera";
constexpr wchar_t kSourceId[] = L"{A5E66477-B2BF-4B9B-8861-DF59A0461520}";
constexpr wchar_t kSourceDllName[] = L"WhisperVirtualCameraSource.dll";
constexpr wchar_t kMarkerName[] = L"virtual-camera-installed.json";
constexpr wchar_t kResultName[] = L"virtual-camera-last-result.json";

struct OperationResult {
    HRESULT result;
    const wchar_t* stage;
};

std::filesystem::path ExecutableDirectory() {
    std::wstring path(32768, L'\0');
    const DWORD length = GetModuleFileNameW(nullptr, path.data(), static_cast<DWORD>(path.size()));
    path.resize(length);
    return std::filesystem::path(path).parent_path();
}

std::filesystem::path InstallDirectory() {
    std::wstring programData(32768, L'\0');
    const DWORD length = GetEnvironmentVariableW(L"ProgramData", programData.data(), static_cast<DWORD>(programData.size()));
    if (length == 0 || length >= programData.size()) return ExecutableDirectory();
    programData.resize(length);
    return std::filesystem::path(programData) / L"InterviewWhisperer" / L"VirtualCamera";
}

std::string ToUtf8(std::wstring_view value) {
    if (value.empty()) return {};
    const int length = WideCharToMultiByte(
        CP_UTF8,
        0,
        value.data(),
        static_cast<int>(value.size()),
        nullptr,
        0,
        nullptr,
        nullptr);
    if (length <= 0) return {};
    std::string utf8(static_cast<std::size_t>(length), '\0');
    WideCharToMultiByte(
        CP_UTF8,
        0,
        value.data(),
        static_cast<int>(value.size()),
        utf8.data(),
        length,
        nullptr,
        nullptr);
    return utf8;
}

std::string JsonEscape(std::string_view value) {
    std::string escaped;
    escaped.reserve(value.size());
    for (const unsigned char character : value) {
        switch (character) {
            case '\\': escaped += "\\\\"; break;
            case '"': escaped += "\\\""; break;
            case '\b': escaped += "\\b"; break;
            case '\f': escaped += "\\f"; break;
            case '\n': escaped += "\\n"; break;
            case '\r': escaped += "\\r"; break;
            case '\t': escaped += "\\t"; break;
            default:
                escaped.push_back(character < 0x20 ? ' ' : static_cast<char>(character));
                break;
        }
    }
    return escaped;
}

std::string HResultHex(HRESULT result) {
    std::ostringstream stream;
    stream << "0x" << std::uppercase << std::hex << std::setw(8) << std::setfill('0')
           << static_cast<std::uint32_t>(result);
    return stream.str();
}

std::wstring SystemMessage(HRESULT result) {
    wchar_t* buffer = nullptr;
    const DWORD length = FormatMessageW(
        FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS,
        nullptr,
        static_cast<DWORD>(result),
        0,
        reinterpret_cast<wchar_t*>(&buffer),
        0,
        nullptr);
    if (length == 0 || !buffer) return {};
    std::wstring message(buffer, length);
    LocalFree(buffer);
    while (!message.empty()
        && (message.back() == L'\r' || message.back() == L'\n' || message.back() == L' ')) {
        message.pop_back();
    }
    return message;
}

void WriteResultFile(
    const std::filesystem::path& installDirectory,
    std::wstring_view action,
    const OperationResult& operation,
    const wchar_t* message) {
    std::error_code ignored;
    std::filesystem::create_directories(installDirectory, ignored);
    std::ofstream output(installDirectory / kResultName, std::ios::trunc);
    if (!output) return;

    const auto updatedAt = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::system_clock::now().time_since_epoch()).count();
    const std::string actionText = JsonEscape(ToUtf8(action));
    const std::string stageText = JsonEscape(ToUtf8(operation.stage));
    const std::string messageText = JsonEscape(ToUtf8(message));
    const std::string systemMessage = JsonEscape(ToUtf8(SystemMessage(operation.result)));
    output << "{\n"
           << "  \"ok\": " << (SUCCEEDED(operation.result) ? "true" : "false") << ",\n"
           << "  \"action\": \"" << actionText << "\",\n"
           << "  \"stage\": \"" << stageText << "\",\n"
           << "  \"message\": \"" << messageText << "\",\n"
           << "  \"hresult\": \"" << HResultHex(operation.result) << "\",\n"
           << "  \"systemMessage\": \"" << systemMessage << "\",\n"
           << "  \"updatedAt\": " << updatedAt << "\n"
           << "}\n";
}

void PrintResult(const OperationResult& operation, const wchar_t* message) {
    std::cout << "{\"ok\":" << (SUCCEEDED(operation.result) ? "true" : "false")
              << ",\"stage\":\"" << JsonEscape(ToUtf8(operation.stage)) << "\""
              << ",\"message\":\"" << JsonEscape(ToUtf8(message)) << "\""
              << ",\"hresult\":\"" << HResultHex(operation.result) << "\"}"
              << std::endl;
}

HRESULT InvokeRegistration(const std::filesystem::path& sourcePath, const char* exportName) {
    HMODULE module = LoadLibraryExW(sourcePath.c_str(), nullptr, LOAD_WITH_ALTERED_SEARCH_PATH);
    if (!module) return HRESULT_FROM_WIN32(GetLastError());

    using RegistrationFunction = HRESULT(STDAPICALLTYPE*)();
    const auto registration = reinterpret_cast<RegistrationFunction>(GetProcAddress(module, exportName));
    const HRESULT hr = registration ? registration() : HRESULT_FROM_WIN32(ERROR_PROC_NOT_FOUND);
    FreeLibrary(module);
    return hr;
}

HRESULT OpenVirtualCamera(ComPtr<IMFVirtualCamera>& camera, const wchar_t*& stage) {
    stage = L"check-support";
    BOOL supported = FALSE;
    HRESULT hr = MFIsVirtualCameraTypeSupported(MFVirtualCameraType_SoftwareCameraSource, &supported);
    if (FAILED(hr)) return hr;
    if (!supported) return HRESULT_FROM_WIN32(ERROR_NOT_SUPPORTED);

    stage = L"create-camera";
    return MFCreateVirtualCamera(
        MFVirtualCameraType_SoftwareCameraSource,
        MFVirtualCameraLifetime_System,
        MFVirtualCameraAccess_CurrentUser,
        kFriendlyName,
        kSourceId,
        nullptr,
        0,
        camera.ReleaseAndGetAddressOf());
}

OperationResult Install(
    const std::filesystem::path& bundleDirectory,
    const std::filesystem::path& installDirectory) {
    const auto bundledSourcePath = bundleDirectory / kSourceDllName;
    const auto installedSourcePath = installDirectory / kSourceDllName;
    if (!std::filesystem::exists(bundledSourcePath)) {
        return {HRESULT_FROM_WIN32(ERROR_FILE_NOT_FOUND), L"find-source"};
    }

    std::error_code fileError;
    std::filesystem::create_directories(installDirectory, fileError);
    if (fileError) return {HRESULT_FROM_WIN32(fileError.value()), L"create-install-directory"};
    std::filesystem::copy_file(
        bundledSourcePath,
        installedSourcePath,
        std::filesystem::copy_options::overwrite_existing,
        fileError);
    if (fileError) return {HRESULT_FROM_WIN32(fileError.value()), L"copy-source"};

    HRESULT hr = InvokeRegistration(installedSourcePath, "DllRegisterServer");
    if (FAILED(hr)) return {hr, L"register-source"};

    ComPtr<IMFVirtualCamera> camera;
    const wchar_t* stage = L"check-support";
    hr = OpenVirtualCamera(camera, stage);
    if (SUCCEEDED(hr)) {
        stage = L"start-camera";
        hr = camera->Start(nullptr);
    }
    if (camera) camera->Shutdown();
    if (FAILED(hr)) {
        InvokeRegistration(installedSourcePath, "DllUnregisterServer");
        return {hr, stage};
    }

    const auto installedAt = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::system_clock::now().time_since_epoch()).count();
    std::ofstream marker(installDirectory / kMarkerName, std::ios::trunc);
    if (!marker) {
        ComPtr<IMFVirtualCamera> cleanupCamera;
        const wchar_t* cleanupStage = L"check-support";
        if (SUCCEEDED(OpenVirtualCamera(cleanupCamera, cleanupStage))) {
            cleanupCamera->Remove();
            cleanupCamera->Shutdown();
        }
        InvokeRegistration(installedSourcePath, "DllUnregisterServer");
        return {HRESULT_FROM_WIN32(ERROR_WRITE_FAULT), L"write-install-marker"};
    }
    marker << "{\n"
           << "  \"deviceName\": \"Whisper Virtual Camera\",\n"
           << "  \"sourceId\": \"{A5E66477-B2BF-4B9B-8861-DF59A0461520}\",\n"
           << "  \"installedAt\": " << installedAt << "\n"
           << "}\n";
    return {S_OK, L"complete"};
}

OperationResult Remove(const std::filesystem::path& installDirectory) {
    HRESULT cameraResult = S_OK;
    ComPtr<IMFVirtualCamera> camera;
    const wchar_t* cameraStage = L"check-support";
    HRESULT hr = OpenVirtualCamera(camera, cameraStage);
    if (SUCCEEDED(hr)) {
        cameraStage = L"remove-camera";
        cameraResult = camera->Remove();
    } else {
        cameraResult = hr;
    }
    if (camera) camera->Shutdown();

    const auto sourcePath = installDirectory / kSourceDllName;
    HRESULT registrationResult = S_OK;
    if (std::filesystem::exists(sourcePath)) {
        registrationResult = InvokeRegistration(sourcePath, "DllUnregisterServer");
    }
    std::error_code ignored;
    std::filesystem::remove(installDirectory / kMarkerName, ignored);
    std::filesystem::remove(sourcePath, ignored);

    if (FAILED(cameraResult)) return {cameraResult, cameraStage};
    if (FAILED(registrationResult)) return {registrationResult, L"unregister-source"};
    return {S_OK, L"complete"};
}

}  // namespace

int wmain(int argc, wchar_t* argv[]) {
    const std::filesystem::path installDirectory = InstallDirectory();
    const std::wstring command = argc > 1 ? argv[1] : L"--status";
    const HRESULT comResult = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    if (FAILED(comResult) && comResult != RPC_E_CHANGED_MODE) {
        const OperationResult operation{comResult, L"initialize-com"};
        PrintResult(operation, L"COM initialization failed.");
        WriteResultFile(installDirectory, command, operation, L"COM initialization failed.");
        return 1;
    }

    const HRESULT startupResult = MFStartup(MF_VERSION, MFSTARTUP_FULL);
    if (FAILED(startupResult)) {
        const OperationResult operation{startupResult, L"initialize-media-foundation"};
        PrintResult(operation, L"Media Foundation initialization failed.");
        WriteResultFile(
            installDirectory,
            command,
            operation,
            L"Media Foundation initialization failed.");
        if (SUCCEEDED(comResult)) CoUninitialize();
        return 1;
    }

    const std::filesystem::path bundleDirectory = ExecutableDirectory();
    OperationResult operation{S_OK, L"check-support"};
    const wchar_t* message = L"Virtual camera support is available.";

    if (command == L"--install") {
        operation = Install(bundleDirectory, installDirectory);
        message = SUCCEEDED(operation.result)
            ? L"Whisper Virtual Camera was installed. Restart Zoom or Teams before selecting it."
            : L"Whisper Virtual Camera installation failed.";
    } else if (command == L"--remove") {
        operation = Remove(installDirectory);
        message = SUCCEEDED(operation.result)
            ? L"Whisper Virtual Camera was removed."
            : L"Whisper Virtual Camera removal failed.";
    } else if (command == L"--status") {
        BOOL supported = FALSE;
        operation.result = MFIsVirtualCameraTypeSupported(
            MFVirtualCameraType_SoftwareCameraSource,
            &supported);
        if (SUCCEEDED(operation.result) && !supported) {
            operation.result = HRESULT_FROM_WIN32(ERROR_NOT_SUPPORTED);
        }
        if (SUCCEEDED(operation.result) && !std::filesystem::exists(bundleDirectory / kSourceDllName)) {
            operation = {HRESULT_FROM_WIN32(ERROR_FILE_NOT_FOUND), L"find-source"};
            message = L"Windows supports virtual cameras, but the Whisper media source is not built yet.";
        }
    } else {
        operation = {E_INVALIDARG, L"validate-command"};
        message = L"Usage: WhisperVirtualCameraManager.exe --status|--install|--remove";
    }

    PrintResult(operation, message);
    WriteResultFile(installDirectory, command, operation, message);
    MFShutdown();
    if (SUCCEEDED(comResult)) CoUninitialize();
    return SUCCEEDED(operation.result) ? 0 : 1;
}
