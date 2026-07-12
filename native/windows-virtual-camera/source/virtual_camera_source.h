#pragma once

#include "frame_reader.h"

#include <unknwn.h>
#include <windows.h>
#include <ole2.h>
#include <mfapi.h>
#include <mferror.h>
#include <mfidl.h>
#include <mfobjects.h>
#include <propvarutil.h>
#include <ks.h>
#include <ksmedia.h>
#include <wrl.h>
#include <wrl/client.h>

#include <atomic>
#include <cstdint>
#include <mutex>
#include <vector>

namespace whisper::virtual_camera {

inline constexpr GUID kSourceClsid = {
    0xa5e66477, 0xb2bf, 0x4b9b, {0x88, 0x61, 0xdf, 0x59, 0xa0, 0x46, 0x15, 0x20}
};
inline constexpr wchar_t kSourceClsidString[] = L"{A5E66477-B2BF-4B9B-8861-DF59A0461520}";
inline constexpr std::uint32_t kVideoWidth = 1280;
inline constexpr std::uint32_t kVideoHeight = 720;
inline constexpr std::uint32_t kVideoFps = 30;
inline constexpr LONGLONG kFrameDuration100Ns = 10'000'000LL / kVideoFps;

extern std::atomic<long> g_objectCount;

class ModuleTracked {
protected:
    ModuleTracked() { g_objectCount.fetch_add(1, std::memory_order_relaxed); }
    ~ModuleTracked() { g_objectCount.fetch_sub(1, std::memory_order_relaxed); }
};

#define WHISPER_RETURN_IF_FAILED(expression) \
    do { \
        const HRESULT whisperResult = (expression); \
        if (FAILED(whisperResult)) return whisperResult; \
    } while (false)

class CameraMediaStream;

class CameraMediaSource final
    : public Microsoft::WRL::RuntimeClass<
        Microsoft::WRL::RuntimeClassFlags<Microsoft::WRL::ClassicCom>,
        IMFMediaSourceEx,
        IMFGetService,
        IKsControl,
        IMFSampleAllocatorControl>
    , public ModuleTracked {
public:
    HRESULT Initialize(IMFAttributes* activationAttributes);

    IFACEMETHODIMP BeginGetEvent(IMFAsyncCallback* callback, IUnknown* state) override;
    IFACEMETHODIMP EndGetEvent(IMFAsyncResult* result, IMFMediaEvent** event) override;
    IFACEMETHODIMP GetEvent(DWORD flags, IMFMediaEvent** event) override;
    IFACEMETHODIMP QueueEvent(MediaEventType type, REFGUID extendedType, HRESULT status, const PROPVARIANT* value) override;

    IFACEMETHODIMP CreatePresentationDescriptor(IMFPresentationDescriptor** descriptor) override;
    IFACEMETHODIMP GetCharacteristics(DWORD* characteristics) override;
    IFACEMETHODIMP Pause() override;
    IFACEMETHODIMP Shutdown() override;
    IFACEMETHODIMP Start(
        IMFPresentationDescriptor* descriptor,
        const GUID* timeFormat,
        const PROPVARIANT* startPosition) override;
    IFACEMETHODIMP Stop() override;

    IFACEMETHODIMP GetSourceAttributes(IMFAttributes** attributes) override;
    IFACEMETHODIMP GetStreamAttributes(DWORD streamIdentifier, IMFAttributes** attributes) override;
    IFACEMETHODIMP SetD3DManager(IUnknown* manager) override;

    IFACEMETHODIMP GetService(REFGUID service, REFIID iid, void** object) override;

    IFACEMETHODIMP KsProperty(
        PKSPROPERTY property,
        ULONG propertyLength,
        void* propertyData,
        ULONG dataLength,
        ULONG* bytesReturned) override;
    IFACEMETHODIMP KsMethod(
        PKSMETHOD method,
        ULONG methodLength,
        void* methodData,
        ULONG dataLength,
        ULONG* bytesReturned) override;
    IFACEMETHODIMP KsEvent(
        PKSEVENT event,
        ULONG eventLength,
        void* eventData,
        ULONG dataLength,
        ULONG* bytesReturned) override;

    IFACEMETHODIMP SetDefaultAllocator(DWORD outputStreamId, IUnknown* allocator) override;
    IFACEMETHODIMP GetAllocatorUsage(
        DWORD outputStreamId,
        DWORD* inputStreamId,
        MFSampleAllocatorUsage* usage) override;

private:
    enum class State { Invalid, Stopped, Started, Shutdown };

    HRESULT CheckShutdownLocked() const;
    HRESULT CreateSourceAttributes(IMFAttributes* activationAttributes);

    mutable std::mutex mutex_;
    State state_ = State::Invalid;
    bool streamSelected_ = false;
    Microsoft::WRL::ComPtr<IMFMediaEventQueue> eventQueue_;
    Microsoft::WRL::ComPtr<IMFPresentationDescriptor> presentationDescriptor_;
    Microsoft::WRL::ComPtr<IMFAttributes> attributes_;
    Microsoft::WRL::ComPtr<CameraMediaStream> stream_;
};

class CameraMediaStream final
    : public Microsoft::WRL::RuntimeClass<
        Microsoft::WRL::RuntimeClassFlags<Microsoft::WRL::ClassicCom>,
        IMFMediaStream2>
    , public ModuleTracked {
public:
    HRESULT Initialize(CameraMediaSource* source, DWORD streamId);
    HRESULT Start(IMFMediaType* mediaType);
    HRESULT Stop(bool queueEvent);
    HRESULT Shutdown();
    HRESULT SetSampleAllocator(IMFVideoSampleAllocator* allocator);
    HRESULT CopyAttributes(IMFAttributes** attributes);
    DWORD Id() const { return streamId_; }

    IFACEMETHODIMP BeginGetEvent(IMFAsyncCallback* callback, IUnknown* state) override;
    IFACEMETHODIMP EndGetEvent(IMFAsyncResult* result, IMFMediaEvent** event) override;
    IFACEMETHODIMP GetEvent(DWORD flags, IMFMediaEvent** event) override;
    IFACEMETHODIMP QueueEvent(MediaEventType type, REFGUID extendedType, HRESULT status, const PROPVARIANT* value) override;

    IFACEMETHODIMP GetMediaSource(IMFMediaSource** source) override;
    IFACEMETHODIMP GetStreamDescriptor(IMFStreamDescriptor** descriptor) override;
    IFACEMETHODIMP RequestSample(IUnknown* token) override;

    IFACEMETHODIMP SetStreamState(MF_STREAM_STATE state) override;
    IFACEMETHODIMP GetStreamState(MF_STREAM_STATE* state) override;

private:
    HRESULT CheckShutdownLocked() const;
    HRESULT StartLocked(bool queueEvent, IMFMediaType* mediaType);
    HRESULT StopLocked(bool queueEvent);
    HRESULT CreateSampleLocked(IMFSample** sample);
    HRESULT WriteLatestFrameLocked(IMFSample* sample);

    mutable std::mutex mutex_;
    bool shutdown_ = false;
    bool selected_ = false;
    DWORD streamId_ = 0;
    MF_STREAM_STATE streamState_ = MF_STREAM_STATE_STOPPED;
    LONGLONG nextSampleTime_ = 0;
    std::uint64_t lastFrameSequence_ = 0;
    Microsoft::WRL::ComPtr<IMFMediaSource> parent_;
    Microsoft::WRL::ComPtr<IMFMediaEventQueue> eventQueue_;
    Microsoft::WRL::ComPtr<IMFAttributes> attributes_;
    Microsoft::WRL::ComPtr<IMFStreamDescriptor> descriptor_;
    Microsoft::WRL::ComPtr<IMFMediaType> mediaType_;
    Microsoft::WRL::ComPtr<IMFVideoSampleAllocator> sampleAllocator_;
    FrameReader frameReader_;
    Nv12Frame latestFrame_;
    std::vector<std::uint8_t> blackFrame_;
    std::vector<std::uint8_t> scaledFrame_;
};

class CameraActivate final
    : public Microsoft::WRL::RuntimeClass<
        Microsoft::WRL::RuntimeClassFlags<Microsoft::WRL::ClassicCom>,
        IMFActivate>
    , public ModuleTracked {
public:
    HRESULT Initialize();

    IFACEMETHODIMP ActivateObject(REFIID iid, void** object) override;
    IFACEMETHODIMP ShutdownObject() override;
    IFACEMETHODIMP DetachObject() override;

    IFACEMETHODIMP GetItem(REFGUID key, PROPVARIANT* value) override;
    IFACEMETHODIMP GetItemType(REFGUID key, MF_ATTRIBUTE_TYPE* type) override;
    IFACEMETHODIMP CompareItem(REFGUID key, REFPROPVARIANT value, BOOL* result) override;
    IFACEMETHODIMP Compare(IMFAttributes* theirs, MF_ATTRIBUTES_MATCH_TYPE matchType, BOOL* result) override;
    IFACEMETHODIMP GetUINT32(REFGUID key, UINT32* value) override;
    IFACEMETHODIMP GetUINT64(REFGUID key, UINT64* value) override;
    IFACEMETHODIMP GetDouble(REFGUID key, double* value) override;
    IFACEMETHODIMP GetGUID(REFGUID key, GUID* value) override;
    IFACEMETHODIMP GetStringLength(REFGUID key, UINT32* length) override;
    IFACEMETHODIMP GetString(REFGUID key, LPWSTR value, UINT32 size, UINT32* length) override;
    IFACEMETHODIMP GetAllocatedString(REFGUID key, LPWSTR* value, UINT32* length) override;
    IFACEMETHODIMP GetBlobSize(REFGUID key, UINT32* size) override;
    IFACEMETHODIMP GetBlob(REFGUID key, UINT8* buffer, UINT32 size, UINT32* blobSize) override;
    IFACEMETHODIMP GetAllocatedBlob(REFGUID key, UINT8** buffer, UINT32* size) override;
    IFACEMETHODIMP GetUnknown(REFGUID key, REFIID iid, void** object) override;
    IFACEMETHODIMP SetItem(REFGUID key, REFPROPVARIANT value) override;
    IFACEMETHODIMP DeleteItem(REFGUID key) override;
    IFACEMETHODIMP DeleteAllItems() override;
    IFACEMETHODIMP SetUINT32(REFGUID key, UINT32 value) override;
    IFACEMETHODIMP SetUINT64(REFGUID key, UINT64 value) override;
    IFACEMETHODIMP SetDouble(REFGUID key, double value) override;
    IFACEMETHODIMP SetGUID(REFGUID key, REFGUID value) override;
    IFACEMETHODIMP SetString(REFGUID key, LPCWSTR value) override;
    IFACEMETHODIMP SetBlob(REFGUID key, const UINT8* buffer, UINT32 size) override;
    IFACEMETHODIMP SetUnknown(REFGUID key, IUnknown* unknown) override;
    IFACEMETHODIMP LockStore() override;
    IFACEMETHODIMP UnlockStore() override;
    IFACEMETHODIMP GetCount(UINT32* items) override;
    IFACEMETHODIMP GetItemByIndex(UINT32 index, GUID* key, PROPVARIANT* value) override;
    IFACEMETHODIMP CopyAllItems(IMFAttributes* destination) override;

private:
    Microsoft::WRL::ComPtr<IMFAttributes> attributes_;
    Microsoft::WRL::ComPtr<CameraMediaSource> source_;
    std::mutex mutex_;
};

class CameraClassFactory final
    : public Microsoft::WRL::RuntimeClass<
        Microsoft::WRL::RuntimeClassFlags<Microsoft::WRL::ClassicCom>,
        IClassFactory>
    , public ModuleTracked {
public:
    IFACEMETHODIMP CreateInstance(IUnknown* outer, REFIID iid, void** object) override;
    IFACEMETHODIMP LockServer(BOOL lock) override;
};

}  // namespace whisper::virtual_camera
