#include <windows.h>
#include <mfapi.h>
#include <mfvirtualcamera.h>
#include <wrl/client.h>

#include <chrono>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <string>

namespace {

using Microsoft::WRL::ComPtr;

constexpr wchar_t kFriendlyName[] = L"Whisper Virtual Camera";
constexpr wchar_t kSourceId[] = L"{A5E66477-B2BF-4B9B-8861-DF59A0461520}";
constexpr wchar_t kSourceDllName[] = L"WhisperVirtualCameraSource.dll";
constexpr wchar_t kMarkerName[] = L"virtual-camera-installed.json";

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

void PrintResult(bool ok, const wchar_t* message, HRESULT hr = S_OK) {
    std::wcout << L"{\"ok\":" << (ok ? L"true" : L"false")
               << L",\"message\":\"" << message << L"\"";
    if (FAILED(hr)) {
        std::wcout << L",\"hresult\":\"0x" << std::hex << static_cast<unsigned long>(hr) << L"\"";
    }
    std::wcout << L"}" << std::endl;
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

HRESULT OpenVirtualCamera(ComPtr<IMFVirtualCamera>& camera) {
    BOOL supported = FALSE;
    HRESULT hr = MFIsVirtualCameraTypeSupported(MFVirtualCameraType_SoftwareCameraSource, &supported);
    if (FAILED(hr)) return hr;
    if (!supported) return HRESULT_FROM_WIN32(ERROR_NOT_SUPPORTED);

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

HRESULT Install(const std::filesystem::path& bundleDirectory, const std::filesystem::path& installDirectory) {
    const auto bundledSourcePath = bundleDirectory / kSourceDllName;
    const auto installedSourcePath = installDirectory / kSourceDllName;
    if (!std::filesystem::exists(bundledSourcePath)) return HRESULT_FROM_WIN32(ERROR_FILE_NOT_FOUND);

    std::error_code fileError;
    std::filesystem::create_directories(installDirectory, fileError);
    if (fileError) return HRESULT_FROM_WIN32(fileError.value());
    std::filesystem::copy_file(
        bundledSourcePath,
        installedSourcePath,
        std::filesystem::copy_options::overwrite_existing,
        fileError);
    if (fileError) return HRESULT_FROM_WIN32(fileError.value());

    HRESULT hr = InvokeRegistration(installedSourcePath, "DllRegisterServer");
    if (FAILED(hr)) return hr;

    ComPtr<IMFVirtualCamera> camera;
    hr = OpenVirtualCamera(camera);
    if (SUCCEEDED(hr)) hr = camera->Start(nullptr);
    if (camera) camera->Shutdown();
    if (FAILED(hr)) {
        InvokeRegistration(installedSourcePath, "DllUnregisterServer");
        return hr;
    }

    const auto installedAt = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::system_clock::now().time_since_epoch()).count();
    std::ofstream marker(installDirectory / kMarkerName, std::ios::trunc);
    if (!marker) {
        ComPtr<IMFVirtualCamera> cleanupCamera;
        if (SUCCEEDED(OpenVirtualCamera(cleanupCamera))) {
            cleanupCamera->Remove();
            cleanupCamera->Shutdown();
        }
        InvokeRegistration(installedSourcePath, "DllUnregisterServer");
        return HRESULT_FROM_WIN32(ERROR_WRITE_FAULT);
    }
    marker << "{\n"
           << "  \"deviceName\": \"Whisper Virtual Camera\",\n"
           << "  \"sourceId\": \"{A5E66477-B2BF-4B9B-8861-DF59A0461520}\",\n"
           << "  \"installedAt\": " << installedAt << "\n"
           << "}\n";
    return S_OK;
}

HRESULT Remove(const std::filesystem::path& installDirectory) {
    HRESULT cameraResult = S_OK;
    ComPtr<IMFVirtualCamera> camera;
    HRESULT hr = OpenVirtualCamera(camera);
    if (SUCCEEDED(hr)) cameraResult = camera->Remove();
    if (camera) camera->Shutdown();

    const auto sourcePath = installDirectory / kSourceDllName;
    HRESULT registrationResult = S_OK;
    if (std::filesystem::exists(sourcePath)) {
        registrationResult = InvokeRegistration(sourcePath, "DllUnregisterServer");
    }
    std::error_code ignored;
    std::filesystem::remove(installDirectory / kMarkerName, ignored);
    std::filesystem::remove(sourcePath, ignored);

    if (FAILED(cameraResult)) return cameraResult;
    return registrationResult;
}

}  // namespace

int wmain(int argc, wchar_t* argv[]) {
    const HRESULT comResult = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    if (FAILED(comResult) && comResult != RPC_E_CHANGED_MODE) {
        PrintResult(false, L"COM initialization failed.", comResult);
        return 1;
    }

    const HRESULT startupResult = MFStartup(MF_VERSION, MFSTARTUP_FULL);
    if (FAILED(startupResult)) {
        PrintResult(false, L"Media Foundation initialization failed.", startupResult);
        if (SUCCEEDED(comResult)) CoUninitialize();
        return 1;
    }

    const std::filesystem::path bundleDirectory = ExecutableDirectory();
    const std::filesystem::path installDirectory = InstallDirectory();
    const std::wstring command = argc > 1 ? argv[1] : L"--status";
    HRESULT result = S_OK;
    const wchar_t* message = L"Virtual camera support is available.";

    if (command == L"--install") {
        result = Install(bundleDirectory, installDirectory);
        message = SUCCEEDED(result)
            ? L"Whisper Virtual Camera was installed. Restart Zoom or Teams before selecting it."
            : L"Whisper Virtual Camera installation failed.";
    } else if (command == L"--remove") {
        result = Remove(installDirectory);
        message = SUCCEEDED(result)
            ? L"Whisper Virtual Camera was removed."
            : L"Whisper Virtual Camera removal failed.";
    } else if (command == L"--status") {
        BOOL supported = FALSE;
        result = MFIsVirtualCameraTypeSupported(MFVirtualCameraType_SoftwareCameraSource, &supported);
        if (SUCCEEDED(result) && !supported) result = HRESULT_FROM_WIN32(ERROR_NOT_SUPPORTED);
        if (SUCCEEDED(result) && !std::filesystem::exists(bundleDirectory / kSourceDllName)) {
            result = HRESULT_FROM_WIN32(ERROR_FILE_NOT_FOUND);
            message = L"Windows supports virtual cameras, but the Whisper media source is not built yet.";
        }
    } else {
        result = E_INVALIDARG;
        message = L"Usage: WhisperVirtualCameraManager.exe --status|--install|--remove";
    }

    PrintResult(SUCCEEDED(result), message, result);
    MFShutdown();
    if (SUCCEEDED(comResult)) CoUninitialize();
    return SUCCEEDED(result) ? 0 : 1;
}
