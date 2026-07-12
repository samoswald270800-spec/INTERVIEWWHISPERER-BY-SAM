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

            ComPtr<IMFMediaStream2> stream;
            if (!exitCode) {
                ComPtr<IMFMediaEvent> streamEvent;
                result = source->GetEvent(0, streamEvent.ReleaseAndGetAddressOf());
                if (FAILED(result)) {
                    exitCode = Fail(L"IMFMediaSource::GetEvent(MENewStream)", result);
                } else {
                    MediaEventType eventType = MEUnknown;
                    result = streamEvent->GetType(&eventType);
                    if (FAILED(result) || eventType != MENewStream) {
                        exitCode = Fail(L"MENewStream event", FAILED(result) ? result : E_UNEXPECTED);
                    }
                }

                if (!exitCode) {
                    PROPVARIANT streamValue;
                    PropVariantInit(&streamValue);
                    result = streamEvent->GetValue(&streamValue);
                    if (SUCCEEDED(result) && streamValue.vt == VT_UNKNOWN && streamValue.punkVal) {
                        result = streamValue.punkVal->QueryInterface(
                            IID_PPV_ARGS(stream.ReleaseAndGetAddressOf()));
                    } else if (SUCCEEDED(result)) {
                        result = E_UNEXPECTED;
                    }
                    PropVariantClear(&streamValue);
                    if (FAILED(result)) exitCode = Fail(L"MENewStream value (IMFMediaStream2)", result);
                }
            }
            if (!exitCode) {
                ComPtr<IMFMediaEvent> startedEvent;
                result = stream->GetEvent(0, startedEvent.ReleaseAndGetAddressOf());
                MediaEventType eventType = MEUnknown;
                if (SUCCEEDED(result)) result = startedEvent->GetType(&eventType);
                if (FAILED(result) || eventType != MEStreamStarted) {
                    exitCode = Fail(L"MEStreamStarted event", FAILED(result) ? result : E_UNEXPECTED);
                }
            }
            if (!exitCode) {
                result = stream->RequestSample(nullptr);
                if (FAILED(result)) exitCode = Fail(L"IMFMediaStream::RequestSample", result);
            }

            ComPtr<IMFSample> sample;
            if (!exitCode) {
                ComPtr<IMFMediaEvent> sampleEvent;
                result = stream->GetEvent(0, sampleEvent.ReleaseAndGetAddressOf());
                if (FAILED(result)) {
                    exitCode = Fail(L"IMFMediaStream::GetEvent(MEMediaSample)", result);
                } else {
                    MediaEventType eventType = MEUnknown;
                    result = sampleEvent->GetType(&eventType);
                    if (FAILED(result) || eventType != MEMediaSample) {
                        exitCode = Fail(L"MEMediaSample event", FAILED(result) ? result : E_UNEXPECTED);
                    }
                }

                if (!exitCode) {
                    PROPVARIANT sampleValue;
                    PropVariantInit(&sampleValue);
                    result = sampleEvent->GetValue(&sampleValue);
                    if (SUCCEEDED(result) && sampleValue.vt == VT_UNKNOWN && sampleValue.punkVal) {
                        result = sampleValue.punkVal->QueryInterface(
                            IID_PPV_ARGS(sample.ReleaseAndGetAddressOf()));
                    } else if (SUCCEEDED(result)) {
                        result = E_UNEXPECTED;
                    }
                    PropVariantClear(&sampleValue);
                    if (FAILED(result)) exitCode = Fail(L"MEMediaSample value", result);
                }
            }
            if (!exitCode) {
                constexpr DWORD expectedFrameBytes = 1280U * 720U * 3U / 2U;
                DWORD sampleBytes = 0;
                result = sample->GetTotalLength(&sampleBytes);
                if (FAILED(result) || sampleBytes != expectedFrameBytes) {
                    exitCode = Fail(L"IMFSample frame length", FAILED(result) ? result : E_UNEXPECTED);
                }

                ComPtr<IMFMediaBuffer> buffer;
                if (!exitCode) {
                    result = sample->ConvertToContiguousBuffer(buffer.ReleaseAndGetAddressOf());
                    if (FAILED(result)) exitCode = Fail(L"ConvertToContiguousBuffer", result);
                }
                if (!exitCode) {
                    BYTE* bytes = nullptr;
                    DWORD maximumLength = 0;
                    DWORD currentLength = 0;
                    result = buffer->Lock(&bytes, &maximumLength, &currentLength);
                    if (FAILED(result)) {
                        exitCode = Fail(L"IMFMediaBuffer::Lock", result);
                    } else {
                        const bool validBlackFrame = currentLength == expectedFrameBytes
                            && maximumLength >= currentLength
                            && bytes[0] == 16
                            && bytes[1280U * 720U] == 128;
                        const HRESULT unlockResult = buffer->Unlock();
                        if (FAILED(unlockResult)) {
                            exitCode = Fail(L"IMFMediaBuffer::Unlock", unlockResult);
                        } else if (!validBlackFrame) {
                            exitCode = Fail(L"NV12 fallback sample", E_UNEXPECTED);
                        }
                    }
                }
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
