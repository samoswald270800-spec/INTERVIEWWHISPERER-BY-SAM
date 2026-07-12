#include <windows.h>
#include <ole2.h>
#include <mfapi.h>
#include <mferror.h>
#include <mfidl.h>
#include <mfobjects.h>
#include <ks.h>
#include <ksmedia.h>
#include <ksproxy.h>
#include <wrl/client.h>

#include <iostream>

namespace {

using Microsoft::WRL::ComPtr;

constexpr GUID kSourceClsid = {
    0xa5e66477, 0xb2bf, 0x4b9b, {0x88, 0x61, 0xdf, 0x59, 0xa0, 0x46, 0x15, 0x20}
};

int Fail(const wchar_t* stage, HRESULT result) {
    std::wcerr << stage << L" failed with 0x" << std::hex
               << static_cast<unsigned long>(result) << std::endl;
    return 1;
}

template <typename Interface>
HRESULT RequireInterface(IUnknown* object) {
    ComPtr<Interface> value;
    return object->QueryInterface(IID_PPV_ARGS(value.ReleaseAndGetAddressOf()));
}

}  // namespace

int wmain(int argc, wchar_t* argv[]) {
    if (argc != 2) return Fail(L"Usage", E_INVALIDARG);

    const HRESULT comResult = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    if (FAILED(comResult) && comResult != RPC_E_CHANGED_MODE) return Fail(L"CoInitializeEx", comResult);

    const HRESULT startupResult = MFStartup(MF_VERSION, MFSTARTUP_FULL);
    if (FAILED(startupResult)) {
        if (SUCCEEDED(comResult)) CoUninitialize();
        return Fail(L"MFStartup", startupResult);
    }

    int exitCode = 0;
    HMODULE module = LoadLibraryExW(argv[1], nullptr, LOAD_WITH_ALTERED_SEARCH_PATH);
    if (!module) {
        exitCode = Fail(L"LoadLibraryExW", HRESULT_FROM_WIN32(GetLastError()));
    } else {
        using GetClassObjectFunction = HRESULT(STDAPICALLTYPE*)(REFCLSID, REFIID, void**);
        const auto getClassObject = reinterpret_cast<GetClassObjectFunction>(
            GetProcAddress(module, "DllGetClassObject"));
        if (!getClassObject) {
            exitCode = Fail(L"GetProcAddress(DllGetClassObject)", HRESULT_FROM_WIN32(GetLastError()));
        } else {
            ComPtr<IClassFactory> factory;
            HRESULT result = getClassObject(kSourceClsid, IID_PPV_ARGS(factory.ReleaseAndGetAddressOf()));
            if (FAILED(result)) exitCode = Fail(L"DllGetClassObject", result);

            ComPtr<IMFActivate> activation;
            if (!exitCode) {
                result = factory->CreateInstance(
                    nullptr,
                    IID_PPV_ARGS(activation.ReleaseAndGetAddressOf()));
                if (FAILED(result)) exitCode = Fail(L"CreateInstance(IMFActivate)", result);
            }
            if (!exitCode) {
                result = RequireInterface<IMFAttributes>(activation.Get());
                if (FAILED(result)) exitCode = Fail(L"QueryInterface(IMFAttributes)", result);
            }

            ComPtr<IMFMediaSource> source;
            if (!exitCode) {
                result = activation->ActivateObject(
                    IID_PPV_ARGS(source.ReleaseAndGetAddressOf()));
                if (FAILED(result)) exitCode = Fail(L"ActivateObject(IMFMediaSource)", result);
            }
            if (!exitCode) {
                result = RequireInterface<IMFMediaSourceEx>(source.Get());
                if (FAILED(result)) exitCode = Fail(L"QueryInterface(IMFMediaSourceEx)", result);
            }
            if (!exitCode) {
                result = RequireInterface<IMFMediaEventGenerator>(source.Get());
                if (FAILED(result)) exitCode = Fail(L"QueryInterface(IMFMediaEventGenerator)", result);
            }
            if (!exitCode) {
                result = RequireInterface<IMFGetService>(source.Get());
                if (FAILED(result)) exitCode = Fail(L"QueryInterface(IMFGetService)", result);
            }
            if (!exitCode) {
                result = RequireInterface<IKsControl>(source.Get());
                if (FAILED(result)) exitCode = Fail(L"QueryInterface(IKsControl)", result);
            }
            if (!exitCode) {
                result = RequireInterface<IMFSampleAllocatorControl>(source.Get());
                if (FAILED(result)) exitCode = Fail(L"QueryInterface(IMFSampleAllocatorControl)", result);
            }

            ComPtr<IMFPresentationDescriptor> descriptor;
            if (!exitCode) {
                result = source->CreatePresentationDescriptor(descriptor.ReleaseAndGetAddressOf());
                if (FAILED(result)) exitCode = Fail(L"CreatePresentationDescriptor", result);
            }
            if (!exitCode) {
                result = descriptor->SelectStream(0);
                if (FAILED(result)) exitCode = Fail(L"SelectStream", result);
            }
            if (!exitCode) {
                PROPVARIANT startPosition;
                PropVariantInit(&startPosition);
                result = source->Start(descriptor.Get(), nullptr, &startPosition);
                if (FAILED(result)) exitCode = Fail(L"IMFMediaSource::Start", result);
            }
            if (!exitCode) {
                result = source->Stop();
                if (FAILED(result)) exitCode = Fail(L"IMFMediaSource::Stop", result);
            }
            if (source) source->Shutdown();
            if (activation) activation->DetachObject();
        }
        FreeLibrary(module);
    }

    MFShutdown();
    if (SUCCEEDED(comResult)) CoUninitialize();
    if (!exitCode) std::wcout << L"Virtual camera source smoke test passed." << std::endl;
    return exitCode;
}
