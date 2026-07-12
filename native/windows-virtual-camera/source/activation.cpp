#include "virtual_camera_source.h"

#include <string>
#include <utility>

namespace whisper::virtual_camera {

std::atomic<long> g_objectCount{0};

HRESULT CameraActivate::Initialize() {
    if (attributes_) return MF_E_ALREADY_INITIALIZED;
    return MFCreateAttributes(attributes_.ReleaseAndGetAddressOf(), 8);
}

HRESULT CameraActivate::ActivateObject(REFIID iid, void** object) {
    if (!object) return E_POINTER;
    *object = nullptr;

    std::lock_guard lock(mutex_);
    if (!attributes_) return MF_E_NOT_INITIALIZED;
    if (!source_) {
        Microsoft::WRL::ComPtr<CameraMediaSource> source =
            Microsoft::WRL::Make<CameraMediaSource>();
        if (!source) return E_OUTOFMEMORY;
        WHISPER_RETURN_IF_FAILED(source->Initialize(attributes_.Get()));
        source_ = std::move(source);
    }
    return source_->QueryInterface(iid, object);
}

HRESULT CameraActivate::ShutdownObject() {
    Microsoft::WRL::ComPtr<CameraMediaSource> source;
    {
        std::lock_guard lock(mutex_);
        source = std::move(source_);
    }
    return source ? source->Shutdown() : S_OK;
}

HRESULT CameraActivate::DetachObject() {
    std::lock_guard lock(mutex_);
    source_.Reset();
    return S_OK;
}

#define WHISPER_FORWARD_ATTRIBUTE(method, parameters, arguments) \
    HRESULT CameraActivate::method parameters { \
        if (!attributes_) return MF_E_NOT_INITIALIZED; \
        return attributes_->method arguments; \
    }

WHISPER_FORWARD_ATTRIBUTE(GetItem, (REFGUID key, PROPVARIANT* value), (key, value))
WHISPER_FORWARD_ATTRIBUTE(GetItemType, (REFGUID key, MF_ATTRIBUTE_TYPE* type), (key, type))
WHISPER_FORWARD_ATTRIBUTE(CompareItem, (REFGUID key, REFPROPVARIANT value, BOOL* result), (key, value, result))
WHISPER_FORWARD_ATTRIBUTE(
    Compare,
    (IMFAttributes* theirs, MF_ATTRIBUTES_MATCH_TYPE matchType, BOOL* result),
    (theirs, matchType, result))
WHISPER_FORWARD_ATTRIBUTE(GetUINT32, (REFGUID key, UINT32* value), (key, value))
WHISPER_FORWARD_ATTRIBUTE(GetUINT64, (REFGUID key, UINT64* value), (key, value))
WHISPER_FORWARD_ATTRIBUTE(GetDouble, (REFGUID key, double* value), (key, value))
WHISPER_FORWARD_ATTRIBUTE(GetGUID, (REFGUID key, GUID* value), (key, value))
WHISPER_FORWARD_ATTRIBUTE(GetStringLength, (REFGUID key, UINT32* length), (key, length))
WHISPER_FORWARD_ATTRIBUTE(
    GetString,
    (REFGUID key, LPWSTR value, UINT32 size, UINT32* length),
    (key, value, size, length))
WHISPER_FORWARD_ATTRIBUTE(
    GetAllocatedString,
    (REFGUID key, LPWSTR* value, UINT32* length),
    (key, value, length))
WHISPER_FORWARD_ATTRIBUTE(GetBlobSize, (REFGUID key, UINT32* size), (key, size))
WHISPER_FORWARD_ATTRIBUTE(
    GetBlob,
    (REFGUID key, UINT8* buffer, UINT32 size, UINT32* blobSize),
    (key, buffer, size, blobSize))
WHISPER_FORWARD_ATTRIBUTE(
    GetAllocatedBlob,
    (REFGUID key, UINT8** buffer, UINT32* size),
    (key, buffer, size))
WHISPER_FORWARD_ATTRIBUTE(
    GetUnknown,
    (REFGUID key, REFIID iid, void** object),
    (key, iid, object))
WHISPER_FORWARD_ATTRIBUTE(SetItem, (REFGUID key, REFPROPVARIANT value), (key, value))
WHISPER_FORWARD_ATTRIBUTE(DeleteItem, (REFGUID key), (key))
WHISPER_FORWARD_ATTRIBUTE(DeleteAllItems, (), ())
WHISPER_FORWARD_ATTRIBUTE(SetUINT32, (REFGUID key, UINT32 value), (key, value))
WHISPER_FORWARD_ATTRIBUTE(SetUINT64, (REFGUID key, UINT64 value), (key, value))
WHISPER_FORWARD_ATTRIBUTE(SetDouble, (REFGUID key, double value), (key, value))
WHISPER_FORWARD_ATTRIBUTE(SetGUID, (REFGUID key, REFGUID value), (key, value))
WHISPER_FORWARD_ATTRIBUTE(SetString, (REFGUID key, LPCWSTR value), (key, value))
WHISPER_FORWARD_ATTRIBUTE(
    SetBlob,
    (REFGUID key, const UINT8* buffer, UINT32 size),
    (key, buffer, size))
WHISPER_FORWARD_ATTRIBUTE(SetUnknown, (REFGUID key, IUnknown* unknown), (key, unknown))
WHISPER_FORWARD_ATTRIBUTE(LockStore, (), ())
WHISPER_FORWARD_ATTRIBUTE(UnlockStore, (), ())
WHISPER_FORWARD_ATTRIBUTE(GetCount, (UINT32* items), (items))
WHISPER_FORWARD_ATTRIBUTE(
    GetItemByIndex,
    (UINT32 index, GUID* key, PROPVARIANT* value),
    (index, key, value))
WHISPER_FORWARD_ATTRIBUTE(CopyAllItems, (IMFAttributes* destination), (destination))

#undef WHISPER_FORWARD_ATTRIBUTE

HRESULT CameraClassFactory::CreateInstance(IUnknown* outer, REFIID iid, void** object) {
    if (!object) return E_POINTER;
    *object = nullptr;
    if (outer) return CLASS_E_NOAGGREGATION;

    Microsoft::WRL::ComPtr<CameraActivate> activation =
        Microsoft::WRL::Make<CameraActivate>();
    if (!activation) return E_OUTOFMEMORY;
    WHISPER_RETURN_IF_FAILED(activation->Initialize());
    return activation->QueryInterface(iid, object);
}

HRESULT CameraClassFactory::LockServer(BOOL lock) {
    if (lock) {
        g_objectCount.fetch_add(1, std::memory_order_relaxed);
    } else {
        g_objectCount.fetch_sub(1, std::memory_order_relaxed);
    }
    return S_OK;
}

}  // namespace whisper::virtual_camera

namespace {

HMODULE g_module = nullptr;

HRESULT GetModulePath(std::wstring& path) {
    path.assign(32768, L'\0');
    const DWORD length = GetModuleFileNameW(g_module, path.data(), static_cast<DWORD>(path.size()));
    if (length == 0) return HRESULT_FROM_WIN32(GetLastError());
    if (length >= path.size() - 1U) return HRESULT_FROM_WIN32(ERROR_INSUFFICIENT_BUFFER);
    path.resize(length);
    return S_OK;
}

HRESULT RegisterComClass() {
    std::wstring modulePath;
    WHISPER_RETURN_IF_FAILED(GetModulePath(modulePath));

    const std::wstring keyPath = std::wstring(L"Software\\Classes\\CLSID\\")
        + whisper::virtual_camera::kSourceClsidString
        + L"\\InprocServer32";
    HKEY key = nullptr;
    const LSTATUS createResult = RegCreateKeyExW(
        HKEY_LOCAL_MACHINE,
        keyPath.c_str(),
        0,
        nullptr,
        REG_OPTION_NON_VOLATILE,
        KEY_SET_VALUE | KEY_WOW64_64KEY,
        nullptr,
        &key,
        nullptr);
    if (createResult != ERROR_SUCCESS) return HRESULT_FROM_WIN32(createResult);

    const DWORD modulePathBytes = static_cast<DWORD>((modulePath.size() + 1U) * sizeof(wchar_t));
    LSTATUS setResult = RegSetValueExW(
        key,
        nullptr,
        0,
        REG_SZ,
        reinterpret_cast<const BYTE*>(modulePath.c_str()),
        modulePathBytes);
    if (setResult == ERROR_SUCCESS) {
        constexpr wchar_t kThreadingModel[] = L"Both";
        setResult = RegSetValueExW(
            key,
            L"ThreadingModel",
            0,
            REG_SZ,
            reinterpret_cast<const BYTE*>(kThreadingModel),
            sizeof(kThreadingModel));
    }
    RegCloseKey(key);
    return setResult == ERROR_SUCCESS ? S_OK : HRESULT_FROM_WIN32(setResult);
}

HRESULT UnregisterComClass() {
    HKEY classRoot = nullptr;
    const LSTATUS openResult = RegOpenKeyExW(
        HKEY_LOCAL_MACHINE,
        L"Software\\Classes\\CLSID",
        0,
        KEY_WRITE | KEY_WOW64_64KEY,
        &classRoot);
    if (openResult == ERROR_FILE_NOT_FOUND || openResult == ERROR_PATH_NOT_FOUND) return S_OK;
    if (openResult != ERROR_SUCCESS) return HRESULT_FROM_WIN32(openResult);

    const LSTATUS deleteResult = RegDeleteTreeW(
        classRoot,
        whisper::virtual_camera::kSourceClsidString);
    RegCloseKey(classRoot);
    if (deleteResult == ERROR_SUCCESS
        || deleteResult == ERROR_FILE_NOT_FOUND
        || deleteResult == ERROR_PATH_NOT_FOUND) {
        return S_OK;
    }
    return HRESULT_FROM_WIN32(deleteResult);
}

}  // namespace

BOOL APIENTRY DllMain(HMODULE module, DWORD reason, LPVOID reserved) {
    (void)reserved;
    if (reason == DLL_PROCESS_ATTACH) {
        g_module = module;
        DisableThreadLibraryCalls(module);
    }
    return TRUE;
}

STDAPI DllGetClassObject(
    REFCLSID clsid,
    REFIID iid,
    void** object) {
    if (!object) return E_POINTER;
    *object = nullptr;
    if (!IsEqualCLSID(clsid, whisper::virtual_camera::kSourceClsid)) {
        return CLASS_E_CLASSNOTAVAILABLE;
    }

    Microsoft::WRL::ComPtr<whisper::virtual_camera::CameraClassFactory> factory =
        Microsoft::WRL::Make<whisper::virtual_camera::CameraClassFactory>();
    if (!factory) return E_OUTOFMEMORY;
    return factory->QueryInterface(iid, object);
}

STDAPI DllCanUnloadNow() {
    return whisper::virtual_camera::g_objectCount.load(std::memory_order_relaxed) == 0
        ? S_OK
        : S_FALSE;
}

STDAPI DllRegisterServer() {
    return RegisterComClass();
}

STDAPI DllUnregisterServer() {
    return UnregisterComClass();
}
