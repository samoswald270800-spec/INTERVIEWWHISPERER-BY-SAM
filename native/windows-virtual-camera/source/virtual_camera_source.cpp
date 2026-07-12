#include "virtual_camera_source.h"

#include <algorithm>
#include <cstring>
#include <utility>
#include <vector>

namespace whisper::virtual_camera {
namespace {

using Microsoft::WRL::ComPtr;

constexpr DWORD kNv12FrameBytes = kVideoWidth * kVideoHeight * 3U / 2U;
constexpr UINT32 kRawVideoBitrate = kVideoWidth * kVideoHeight * 12U * kVideoFps;

struct LinearCoordinate {
    std::uint32_t first = 0;
    std::uint32_t second = 0;
    std::uint32_t weight = 0;
};

LinearCoordinate MapCoordinate(
    std::uint32_t outputIndex,
    std::uint32_t outputLength,
    std::uint32_t cropStart,
    std::uint32_t cropLength) {
    constexpr std::int64_t kOne = 1LL << 16;
    const std::int64_t numerator =
        (static_cast<std::int64_t>(outputIndex) * 2LL + 1LL)
        * static_cast<std::int64_t>(cropLength)
        * kOne;
    std::int64_t coordinate = static_cast<std::int64_t>(cropStart) * kOne
        + numerator / (static_cast<std::int64_t>(outputLength) * 2LL)
        - (kOne / 2LL);
    const std::int64_t minimum = static_cast<std::int64_t>(cropStart) * kOne;
    const std::int64_t maximum =
        static_cast<std::int64_t>(cropStart + cropLength - 1U) * kOne;
    coordinate = std::clamp(coordinate, minimum, maximum);

    const auto first = static_cast<std::uint32_t>(coordinate >> 16);
    return {
        first,
        std::min(first + 1U, cropStart + cropLength - 1U),
        static_cast<std::uint32_t>(coordinate & 0xffff),
    };
}

void ScalePlaneBilinear(
    const std::uint8_t* source,
    std::uint32_t sourceStride,
    std::uint32_t cropX,
    std::uint32_t cropY,
    std::uint32_t cropWidth,
    std::uint32_t cropHeight,
    std::uint8_t* destination,
    std::uint32_t destinationStride,
    std::uint32_t destinationWidth,
    std::uint32_t destinationHeight,
    std::uint32_t channels) {
    std::vector<LinearCoordinate> horizontal(destinationWidth);
    for (std::uint32_t column = 0; column < destinationWidth; ++column) {
        horizontal[column] = MapCoordinate(column, destinationWidth, cropX, cropWidth);
    }

    for (std::uint32_t row = 0; row < destinationHeight; ++row) {
        const LinearCoordinate vertical = MapCoordinate(row, destinationHeight, cropY, cropHeight);
        const auto* firstRow = source + static_cast<std::size_t>(vertical.first) * sourceStride;
        const auto* secondRow = source + static_cast<std::size_t>(vertical.second) * sourceStride;
        auto* output = destination + static_cast<std::size_t>(row) * destinationStride;

        for (std::uint32_t column = 0; column < destinationWidth; ++column) {
            const LinearCoordinate& x = horizontal[column];
            for (std::uint32_t channel = 0; channel < channels; ++channel) {
                const std::size_t firstOffset = static_cast<std::size_t>(x.first) * channels + channel;
                const std::size_t secondOffset = static_cast<std::size_t>(x.second) * channels + channel;
                const std::int32_t topLeft = firstRow[firstOffset];
                const std::int32_t topRight = firstRow[secondOffset];
                const std::int32_t bottomLeft = secondRow[firstOffset];
                const std::int32_t bottomRight = secondRow[secondOffset];
                const std::int32_t top = topLeft
                    + (((topRight - topLeft) * static_cast<std::int32_t>(x.weight) + 32768) >> 16);
                const std::int32_t bottom = bottomLeft
                    + (((bottomRight - bottomLeft) * static_cast<std::int32_t>(x.weight) + 32768) >> 16);
                const std::int32_t value = top
                    + (((bottom - top) * static_cast<std::int32_t>(vertical.weight) + 32768) >> 16);
                output[static_cast<std::size_t>(column) * channels + channel]
                    = static_cast<std::uint8_t>(value);
            }
        }
    }
}

bool ScaleNv12Frame(const Nv12Frame& source, std::vector<std::uint8_t>& destination) {
    if (source.width < 2 || source.height < 2
        || (source.width & 1U) != 0 || (source.height & 1U) != 0) {
        return false;
    }

    const std::size_t sourceYBytes = static_cast<std::size_t>(source.width) * source.height;
    const std::size_t sourceBytes = sourceYBytes + sourceYBytes / 2U;
    if (source.bytes.size() != sourceBytes) return false;

    std::uint32_t cropX = 0;
    std::uint32_t cropY = 0;
    std::uint32_t cropWidth = source.width;
    std::uint32_t cropHeight = source.height;
    if (static_cast<std::uint64_t>(source.width) * kVideoHeight
        > static_cast<std::uint64_t>(source.height) * kVideoWidth) {
        cropWidth = static_cast<std::uint32_t>(
            static_cast<std::uint64_t>(source.height) * kVideoWidth / kVideoHeight) & ~1U;
        cropX = ((source.width - cropWidth) / 2U) & ~1U;
    } else if (static_cast<std::uint64_t>(source.width) * kVideoHeight
        < static_cast<std::uint64_t>(source.height) * kVideoWidth) {
        cropHeight = static_cast<std::uint32_t>(
            static_cast<std::uint64_t>(source.width) * kVideoHeight / kVideoWidth) & ~1U;
        cropY = ((source.height - cropHeight) / 2U) & ~1U;
    }
    if (cropWidth < 2 || cropHeight < 2) return false;

    destination.resize(kNv12FrameBytes);
    const std::size_t destinationYBytes = static_cast<std::size_t>(kVideoWidth) * kVideoHeight;
    ScalePlaneBilinear(
        source.bytes.data(),
        source.width,
        cropX,
        cropY,
        cropWidth,
        cropHeight,
        destination.data(),
        kVideoWidth,
        kVideoWidth,
        kVideoHeight,
        1);
    ScalePlaneBilinear(
        source.bytes.data() + sourceYBytes,
        source.width,
        cropX / 2U,
        cropY / 2U,
        cropWidth / 2U,
        cropHeight / 2U,
        destination.data() + destinationYBytes,
        kVideoWidth,
        kVideoWidth / 2U,
        kVideoHeight / 2U,
        2);
    return true;
}

HRESULT SetStreamAttributes(IMFAttributes* attributes, DWORD streamId) {
    if (!attributes) return E_INVALIDARG;
    WHISPER_RETURN_IF_FAILED(attributes->SetGUID(MF_DEVICESTREAM_STREAM_CATEGORY, PINNAME_VIDEO_CAPTURE));
    WHISPER_RETURN_IF_FAILED(attributes->SetUINT32(MF_DEVICESTREAM_STREAM_ID, streamId));
    WHISPER_RETURN_IF_FAILED(attributes->SetUINT32(MF_DEVICESTREAM_FRAMESERVER_SHARED, TRUE));
    WHISPER_RETURN_IF_FAILED(attributes->SetUINT32(
        MF_DEVICESTREAM_ATTRIBUTE_FRAMESOURCE_TYPES,
        static_cast<UINT32>(MFFrameSourceTypes_Color)));
    return S_OK;
}

}  // namespace

HRESULT CameraMediaSource::Initialize(IMFAttributes* activationAttributes) {
    std::lock_guard lock(mutex_);
    if (state_ != State::Invalid) return MF_E_ALREADY_INITIALIZED;

    WHISPER_RETURN_IF_FAILED(CreateSourceAttributes(activationAttributes));
    WHISPER_RETURN_IF_FAILED(MFCreateEventQueue(eventQueue_.ReleaseAndGetAddressOf()));

    ComPtr<CameraMediaStream> stream = Microsoft::WRL::Make<CameraMediaStream>();
    if (!stream) return E_OUTOFMEMORY;
    WHISPER_RETURN_IF_FAILED(stream->Initialize(this, 0));

    ComPtr<IMFStreamDescriptor> descriptor;
    WHISPER_RETURN_IF_FAILED(stream->GetStreamDescriptor(descriptor.ReleaseAndGetAddressOf()));
    IMFStreamDescriptor* descriptors[] = {descriptor.Get()};
    WHISPER_RETURN_IF_FAILED(MFCreatePresentationDescriptor(
        1,
        descriptors,
        presentationDescriptor_.ReleaseAndGetAddressOf()));

    stream_ = std::move(stream);
    state_ = State::Stopped;
    return S_OK;
}

HRESULT CameraMediaSource::CheckShutdownLocked() const {
    if (state_ == State::Shutdown) return MF_E_SHUTDOWN;
    if (!eventQueue_ || !stream_) return E_UNEXPECTED;
    return S_OK;
}

HRESULT CameraMediaSource::CreateSourceAttributes(IMFAttributes* activationAttributes) {
    WHISPER_RETURN_IF_FAILED(MFCreateAttributes(attributes_.ReleaseAndGetAddressOf(), 4));
    if (activationAttributes) {
        WHISPER_RETURN_IF_FAILED(activationAttributes->CopyAllItems(attributes_.Get()));
    }

    ComPtr<IMFSensorProfileCollection> profiles;
    ComPtr<IMFSensorProfile> legacyProfile;
    WHISPER_RETURN_IF_FAILED(MFCreateSensorProfileCollection(profiles.ReleaseAndGetAddressOf()));
    WHISPER_RETURN_IF_FAILED(MFCreateSensorProfile(
        KSCAMERAPROFILE_Legacy,
        0,
        nullptr,
        legacyProfile.ReleaseAndGetAddressOf()));
    WHISPER_RETURN_IF_FAILED(legacyProfile->AddProfileFilter(0, L"((RES==;FRT<=30,1;SUT==))"));
    WHISPER_RETURN_IF_FAILED(profiles->AddProfile(legacyProfile.Get()));
    WHISPER_RETURN_IF_FAILED(attributes_->SetUnknown(
        MF_DEVICEMFT_SENSORPROFILE_COLLECTION,
        profiles.Get()));
    return S_OK;
}

HRESULT CameraMediaSource::BeginGetEvent(IMFAsyncCallback* callback, IUnknown* state) {
    std::lock_guard lock(mutex_);
    WHISPER_RETURN_IF_FAILED(CheckShutdownLocked());
    return eventQueue_->BeginGetEvent(callback, state);
}

HRESULT CameraMediaSource::EndGetEvent(IMFAsyncResult* result, IMFMediaEvent** event) {
    std::lock_guard lock(mutex_);
    WHISPER_RETURN_IF_FAILED(CheckShutdownLocked());
    return eventQueue_->EndGetEvent(result, event);
}

HRESULT CameraMediaSource::GetEvent(DWORD flags, IMFMediaEvent** event) {
    if (!event) return E_POINTER;
    ComPtr<IMFMediaEventQueue> queue;
    {
        std::lock_guard lock(mutex_);
        WHISPER_RETURN_IF_FAILED(CheckShutdownLocked());
        queue = eventQueue_;
    }
    return queue->GetEvent(flags, event);
}

HRESULT CameraMediaSource::QueueEvent(
    MediaEventType type,
    REFGUID extendedType,
    HRESULT status,
    const PROPVARIANT* value) {
    std::lock_guard lock(mutex_);
    WHISPER_RETURN_IF_FAILED(CheckShutdownLocked());
    return eventQueue_->QueueEventParamVar(type, extendedType, status, value);
}

HRESULT CameraMediaSource::CreatePresentationDescriptor(IMFPresentationDescriptor** descriptor) {
    if (!descriptor) return E_POINTER;
    *descriptor = nullptr;
    std::lock_guard lock(mutex_);
    WHISPER_RETURN_IF_FAILED(CheckShutdownLocked());
    return presentationDescriptor_->Clone(descriptor);
}

HRESULT CameraMediaSource::GetCharacteristics(DWORD* characteristics) {
    if (!characteristics) return E_POINTER;
    std::lock_guard lock(mutex_);
    WHISPER_RETURN_IF_FAILED(CheckShutdownLocked());
    *characteristics = MFMEDIASOURCE_IS_LIVE;
    return S_OK;
}

HRESULT CameraMediaSource::Pause() {
    return MF_E_INVALID_STATE_TRANSITION;
}

HRESULT CameraMediaSource::Shutdown() {
    std::lock_guard lock(mutex_);
    if (state_ == State::Shutdown) return S_OK;
    state_ = State::Shutdown;

    if (stream_) stream_->Shutdown();
    if (eventQueue_) eventQueue_->Shutdown();
    stream_.Reset();
    eventQueue_.Reset();
    presentationDescriptor_.Reset();
    attributes_.Reset();
    streamSelected_ = false;
    return S_OK;
}

HRESULT CameraMediaSource::Start(
    IMFPresentationDescriptor* descriptor,
    const GUID* timeFormat,
    const PROPVARIANT* startPosition) {
    if (!descriptor || !startPosition) return E_INVALIDARG;
    if (timeFormat && *timeFormat != GUID_NULL) return MF_E_UNSUPPORTED_TIME_FORMAT;

    std::lock_guard lock(mutex_);
    WHISPER_RETURN_IF_FAILED(CheckShutdownLocked());
    if (state_ == State::Invalid) return MF_E_INVALID_STATE_TRANSITION;

    DWORD streamCount = 0;
    WHISPER_RETURN_IF_FAILED(descriptor->GetStreamDescriptorCount(&streamCount));
    if (streamCount != 1) return E_INVALIDARG;

    BOOL selected = FALSE;
    ComPtr<IMFStreamDescriptor> streamDescriptor;
    WHISPER_RETURN_IF_FAILED(descriptor->GetStreamDescriptorByIndex(
        0,
        &selected,
        streamDescriptor.ReleaseAndGetAddressOf()));
    if (!selected) return MF_E_MEDIA_SOURCE_NO_STREAMS_SELECTED;

    DWORD streamId = 0;
    WHISPER_RETURN_IF_FAILED(streamDescriptor->GetStreamIdentifier(&streamId));
    if (streamId != stream_->Id()) return MF_E_INVALIDSTREAMNUMBER;

    ComPtr<IMFMediaTypeHandler> typeHandler;
    ComPtr<IMFMediaType> mediaType;
    WHISPER_RETURN_IF_FAILED(streamDescriptor->GetMediaTypeHandler(typeHandler.ReleaseAndGetAddressOf()));
    WHISPER_RETURN_IF_FAILED(typeHandler->GetCurrentMediaType(mediaType.ReleaseAndGetAddressOf()));

    WHISPER_RETURN_IF_FAILED(presentationDescriptor_->SelectStream(0));
    ComPtr<IMFMediaStream> mediaStream;
    WHISPER_RETURN_IF_FAILED(stream_.As(&mediaStream));
    WHISPER_RETURN_IF_FAILED(eventQueue_->QueueEventParamUnk(
        streamSelected_ ? MEUpdatedStream : MENewStream,
        GUID_NULL,
        S_OK,
        mediaStream.Get()));
    WHISPER_RETURN_IF_FAILED(stream_->Start(mediaType.Get()));

    PROPVARIANT startedAt;
    PropVariantInit(&startedAt);
    WHISPER_RETURN_IF_FAILED(InitPropVariantFromInt64(MFGetSystemTime(), &startedAt));
    const HRESULT eventResult = eventQueue_->QueueEventParamVar(
        MESourceStarted,
        GUID_NULL,
        S_OK,
        &startedAt);
    PropVariantClear(&startedAt);
    WHISPER_RETURN_IF_FAILED(eventResult);

    streamSelected_ = true;
    state_ = State::Started;
    return S_OK;
}

HRESULT CameraMediaSource::Stop() {
    std::lock_guard lock(mutex_);
    WHISPER_RETURN_IF_FAILED(CheckShutdownLocked());
    if (state_ != State::Started) return MF_E_INVALID_STATE_TRANSITION;

    state_ = State::Stopped;
    WHISPER_RETURN_IF_FAILED(stream_->Stop(true));
    WHISPER_RETURN_IF_FAILED(presentationDescriptor_->DeselectStream(0));

    PROPVARIANT stoppedAt;
    PropVariantInit(&stoppedAt);
    WHISPER_RETURN_IF_FAILED(InitPropVariantFromInt64(MFGetSystemTime(), &stoppedAt));
    const HRESULT eventResult = eventQueue_->QueueEventParamVar(
        MESourceStopped,
        GUID_NULL,
        S_OK,
        &stoppedAt);
    PropVariantClear(&stoppedAt);
    WHISPER_RETURN_IF_FAILED(eventResult);

    streamSelected_ = false;
    return S_OK;
}

HRESULT CameraMediaSource::GetSourceAttributes(IMFAttributes** attributes) {
    if (!attributes) return E_POINTER;
    *attributes = nullptr;
    std::lock_guard lock(mutex_);
    WHISPER_RETURN_IF_FAILED(CheckShutdownLocked());
    return attributes_.CopyTo(attributes);
}

HRESULT CameraMediaSource::GetStreamAttributes(DWORD streamIdentifier, IMFAttributes** attributes) {
    if (!attributes) return E_POINTER;
    *attributes = nullptr;
    std::lock_guard lock(mutex_);
    WHISPER_RETURN_IF_FAILED(CheckShutdownLocked());
    if (streamIdentifier != stream_->Id()) return MF_E_INVALIDSTREAMNUMBER;
    return stream_->CopyAttributes(attributes);
}

HRESULT CameraMediaSource::SetD3DManager(IUnknown* manager) {
    (void)manager;
    return E_NOTIMPL;
}

HRESULT CameraMediaSource::GetService(REFGUID service, REFIID iid, void** object) {
    (void)service;
    (void)iid;
    if (!object) return E_POINTER;
    *object = nullptr;
    std::lock_guard lock(mutex_);
    WHISPER_RETURN_IF_FAILED(CheckShutdownLocked());
    return MF_E_UNSUPPORTED_SERVICE;
}

HRESULT CameraMediaSource::KsProperty(
    PKSPROPERTY property,
    ULONG propertyLength,
    void* propertyData,
    ULONG dataLength,
    ULONG* bytesReturned) {
    (void)propertyData;
    (void)dataLength;
    if (!property || propertyLength < sizeof(KSPROPERTY)) return E_INVALIDARG;
    if (bytesReturned) *bytesReturned = 0;
    return HRESULT_FROM_WIN32(ERROR_SET_NOT_FOUND);
}

HRESULT CameraMediaSource::KsMethod(
    PKSMETHOD method,
    ULONG methodLength,
    void* methodData,
    ULONG dataLength,
    ULONG* bytesReturned) {
    (void)method;
    (void)methodLength;
    (void)methodData;
    (void)dataLength;
    if (bytesReturned) *bytesReturned = 0;
    return HRESULT_FROM_WIN32(ERROR_SET_NOT_FOUND);
}

HRESULT CameraMediaSource::KsEvent(
    PKSEVENT event,
    ULONG eventLength,
    void* eventData,
    ULONG dataLength,
    ULONG* bytesReturned) {
    (void)event;
    (void)eventLength;
    (void)eventData;
    (void)dataLength;
    if (bytesReturned) *bytesReturned = 0;
    return HRESULT_FROM_WIN32(ERROR_SET_NOT_FOUND);
}

HRESULT CameraMediaSource::SetDefaultAllocator(DWORD outputStreamId, IUnknown* allocator) {
    if (!allocator) return E_POINTER;
    std::lock_guard lock(mutex_);
    WHISPER_RETURN_IF_FAILED(CheckShutdownLocked());
    if (outputStreamId != stream_->Id()) return MF_E_INVALIDSTREAMNUMBER;

    ComPtr<IMFVideoSampleAllocator> videoAllocator;
    WHISPER_RETURN_IF_FAILED(allocator->QueryInterface(
        IID_PPV_ARGS(videoAllocator.ReleaseAndGetAddressOf())));
    return stream_->SetSampleAllocator(videoAllocator.Get());
}

HRESULT CameraMediaSource::GetAllocatorUsage(
    DWORD outputStreamId,
    DWORD* inputStreamId,
    MFSampleAllocatorUsage* usage) {
    if (!inputStreamId || !usage) return E_POINTER;
    std::lock_guard lock(mutex_);
    WHISPER_RETURN_IF_FAILED(CheckShutdownLocked());
    if (outputStreamId != stream_->Id()) return MF_E_INVALIDSTREAMNUMBER;
    *inputStreamId = outputStreamId;
    *usage = MFSampleAllocatorUsage_UsesProvidedAllocator;
    return S_OK;
}

HRESULT CameraMediaStream::Initialize(CameraMediaSource* source, DWORD streamId) {
    if (!source) return E_INVALIDARG;
    std::lock_guard lock(mutex_);
    if (eventQueue_) return MF_E_ALREADY_INITIALIZED;

    WHISPER_RETURN_IF_FAILED(source->QueryInterface(
        IID_PPV_ARGS(parent_.ReleaseAndGetAddressOf())));
    streamId_ = streamId;

    ComPtr<IMFMediaType> mediaType;
    WHISPER_RETURN_IF_FAILED(MFCreateMediaType(mediaType.ReleaseAndGetAddressOf()));
    WHISPER_RETURN_IF_FAILED(mediaType->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video));
    WHISPER_RETURN_IF_FAILED(mediaType->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_NV12));
    WHISPER_RETURN_IF_FAILED(mediaType->SetUINT32(MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive));
    WHISPER_RETURN_IF_FAILED(mediaType->SetUINT32(MF_MT_ALL_SAMPLES_INDEPENDENT, TRUE));
    WHISPER_RETURN_IF_FAILED(MFSetAttributeSize(mediaType.Get(), MF_MT_FRAME_SIZE, kVideoWidth, kVideoHeight));
    WHISPER_RETURN_IF_FAILED(MFSetAttributeRatio(mediaType.Get(), MF_MT_FRAME_RATE, kVideoFps, 1));
    WHISPER_RETURN_IF_FAILED(MFSetAttributeRatio(mediaType.Get(), MF_MT_PIXEL_ASPECT_RATIO, 1, 1));
    WHISPER_RETURN_IF_FAILED(mediaType->SetUINT32(MF_MT_AVG_BITRATE, kRawVideoBitrate));

    WHISPER_RETURN_IF_FAILED(MFCreateAttributes(attributes_.ReleaseAndGetAddressOf(), 8));
    WHISPER_RETURN_IF_FAILED(SetStreamAttributes(attributes_.Get(), streamId_));
    WHISPER_RETURN_IF_FAILED(MFCreateEventQueue(eventQueue_.ReleaseAndGetAddressOf()));

    IMFMediaType* mediaTypes[] = {mediaType.Get()};
    WHISPER_RETURN_IF_FAILED(MFCreateStreamDescriptor(
        streamId_,
        1,
        mediaTypes,
        descriptor_.ReleaseAndGetAddressOf()));
    ComPtr<IMFMediaTypeHandler> typeHandler;
    WHISPER_RETURN_IF_FAILED(descriptor_->GetMediaTypeHandler(typeHandler.ReleaseAndGetAddressOf()));
    WHISPER_RETURN_IF_FAILED(typeHandler->SetCurrentMediaType(mediaType.Get()));
    WHISPER_RETURN_IF_FAILED(SetStreamAttributes(descriptor_.Get(), streamId_));

    mediaType_ = std::move(mediaType);
    blackFrame_.resize(kNv12FrameBytes);
    const auto lumaBytes = static_cast<std::size_t>(kVideoWidth) * kVideoHeight;
    std::fill(blackFrame_.begin(), blackFrame_.begin() + lumaBytes, static_cast<std::uint8_t>(16));
    std::fill(blackFrame_.begin() + lumaBytes, blackFrame_.end(), static_cast<std::uint8_t>(128));
    return S_OK;
}

HRESULT CameraMediaStream::CheckShutdownLocked() const {
    if (shutdown_) return MF_E_SHUTDOWN;
    if (!eventQueue_) return E_UNEXPECTED;
    return S_OK;
}

HRESULT CameraMediaStream::BeginGetEvent(IMFAsyncCallback* callback, IUnknown* state) {
    std::lock_guard lock(mutex_);
    WHISPER_RETURN_IF_FAILED(CheckShutdownLocked());
    return eventQueue_->BeginGetEvent(callback, state);
}

HRESULT CameraMediaStream::EndGetEvent(IMFAsyncResult* result, IMFMediaEvent** event) {
    std::lock_guard lock(mutex_);
    WHISPER_RETURN_IF_FAILED(CheckShutdownLocked());
    return eventQueue_->EndGetEvent(result, event);
}

HRESULT CameraMediaStream::GetEvent(DWORD flags, IMFMediaEvent** event) {
    if (!event) return E_POINTER;
    ComPtr<IMFMediaEventQueue> queue;
    {
        std::lock_guard lock(mutex_);
        WHISPER_RETURN_IF_FAILED(CheckShutdownLocked());
        queue = eventQueue_;
    }
    return queue->GetEvent(flags, event);
}

HRESULT CameraMediaStream::QueueEvent(
    MediaEventType type,
    REFGUID extendedType,
    HRESULT status,
    const PROPVARIANT* value) {
    std::lock_guard lock(mutex_);
    WHISPER_RETURN_IF_FAILED(CheckShutdownLocked());
    return eventQueue_->QueueEventParamVar(type, extendedType, status, value);
}

HRESULT CameraMediaStream::GetMediaSource(IMFMediaSource** source) {
    if (!source) return E_POINTER;
    *source = nullptr;
    std::lock_guard lock(mutex_);
    WHISPER_RETURN_IF_FAILED(CheckShutdownLocked());
    return parent_.CopyTo(source);
}

HRESULT CameraMediaStream::GetStreamDescriptor(IMFStreamDescriptor** descriptor) {
    if (!descriptor) return E_POINTER;
    *descriptor = nullptr;
    std::lock_guard lock(mutex_);
    WHISPER_RETURN_IF_FAILED(CheckShutdownLocked());
    return descriptor_.CopyTo(descriptor);
}

HRESULT CameraMediaStream::RequestSample(IUnknown* token) {
    std::lock_guard lock(mutex_);
    WHISPER_RETURN_IF_FAILED(CheckShutdownLocked());
    if (streamState_ != MF_STREAM_STATE_RUNNING || !selected_) return MF_E_INVALIDREQUEST;

    ComPtr<IMFSample> sample;
    WHISPER_RETURN_IF_FAILED(CreateSampleLocked(sample.ReleaseAndGetAddressOf()));
    WHISPER_RETURN_IF_FAILED(WriteLatestFrameLocked(sample.Get()));

    const LONGLONG now = MFGetSystemTime();
    if (nextSampleTime_ == 0
        || nextSampleTime_ < now - (kFrameDuration100Ns * 2)
        || nextSampleTime_ > now + 10'000'000LL) {
        nextSampleTime_ = now;
    }
    WHISPER_RETURN_IF_FAILED(sample->SetSampleTime(nextSampleTime_));
    WHISPER_RETURN_IF_FAILED(sample->SetSampleDuration(kFrameDuration100Ns));
    WHISPER_RETURN_IF_FAILED(sample->SetUINT32(MFSampleExtension_CleanPoint, TRUE));
    nextSampleTime_ += kFrameDuration100Ns;
    if (token) WHISPER_RETURN_IF_FAILED(sample->SetUnknown(MFSampleExtension_Token, token));

    return eventQueue_->QueueEventParamUnk(MEMediaSample, GUID_NULL, S_OK, sample.Get());
}

HRESULT CameraMediaStream::SetStreamState(MF_STREAM_STATE state) {
    std::lock_guard lock(mutex_);
    WHISPER_RETURN_IF_FAILED(CheckShutdownLocked());
    if (state == streamState_) return S_OK;

    switch (state) {
        case MF_STREAM_STATE_PAUSED:
            if (streamState_ != MF_STREAM_STATE_RUNNING) return MF_E_INVALID_STATE_TRANSITION;
            streamState_ = MF_STREAM_STATE_PAUSED;
            return S_OK;
        case MF_STREAM_STATE_RUNNING:
            return StartLocked(false, mediaType_.Get());
        case MF_STREAM_STATE_STOPPED:
            return StopLocked(false);
        default:
            return MF_E_INVALID_STATE_TRANSITION;
    }
}

HRESULT CameraMediaStream::GetStreamState(MF_STREAM_STATE* state) {
    if (!state) return E_POINTER;
    std::lock_guard lock(mutex_);
    WHISPER_RETURN_IF_FAILED(CheckShutdownLocked());
    *state = streamState_;
    return S_OK;
}

HRESULT CameraMediaStream::Start(IMFMediaType* mediaType) {
    if (!mediaType) return E_INVALIDARG;
    std::lock_guard lock(mutex_);
    WHISPER_RETURN_IF_FAILED(CheckShutdownLocked());
    selected_ = true;
    return StartLocked(true, mediaType);
}

HRESULT CameraMediaStream::Stop(bool queueEvent) {
    std::lock_guard lock(mutex_);
    WHISPER_RETURN_IF_FAILED(CheckShutdownLocked());
    selected_ = false;
    return StopLocked(queueEvent);
}

HRESULT CameraMediaStream::Shutdown() {
    std::lock_guard lock(mutex_);
    if (shutdown_) return S_OK;
    shutdown_ = true;
    selected_ = false;
    streamState_ = MF_STREAM_STATE_STOPPED;
    frameReader_.Stop();

    if (eventQueue_) eventQueue_->Shutdown();
    eventQueue_.Reset();
    parent_.Reset();
    attributes_.Reset();
    descriptor_.Reset();
    mediaType_.Reset();
    sampleAllocator_.Reset();
    latestFrame_ = {};
    scaledFrame_.clear();
    return S_OK;
}

HRESULT CameraMediaStream::SetSampleAllocator(IMFVideoSampleAllocator* allocator) {
    std::lock_guard lock(mutex_);
    WHISPER_RETURN_IF_FAILED(CheckShutdownLocked());
    if (streamState_ == MF_STREAM_STATE_RUNNING) return MF_E_INVALIDREQUEST;
    sampleAllocator_ = allocator;
    return S_OK;
}

HRESULT CameraMediaStream::CopyAttributes(IMFAttributes** attributes) {
    if (!attributes) return E_POINTER;
    *attributes = nullptr;
    std::lock_guard lock(mutex_);
    WHISPER_RETURN_IF_FAILED(CheckShutdownLocked());
    return attributes_.CopyTo(attributes);
}

HRESULT CameraMediaStream::StartLocked(bool queueEvent, IMFMediaType* mediaType) {
    if (!mediaType) return E_INVALIDARG;

    BOOL matches = FALSE;
    if (mediaType_) {
        (void)mediaType_->Compare(mediaType, MF_ATTRIBUTES_MATCH_ALL_ITEMS, &matches);
    }
    const bool needsInitialization = streamState_ != MF_STREAM_STATE_RUNNING || !matches;
    if (!matches) mediaType_ = mediaType;

    if (needsInitialization && sampleAllocator_) {
        WHISPER_RETURN_IF_FAILED(sampleAllocator_->InitializeSampleAllocator(5, mediaType_.Get()));
    }

    if (streamState_ != MF_STREAM_STATE_RUNNING) {
        latestFrame_ = {};
        scaledFrame_.clear();
        lastFrameSequence_ = 0;
        nextSampleTime_ = 0;
        frameReader_.Start();
    }
    streamState_ = MF_STREAM_STATE_RUNNING;
    if (queueEvent) {
        WHISPER_RETURN_IF_FAILED(eventQueue_->QueueEventParamVar(
            MEStreamStarted,
            GUID_NULL,
            S_OK,
            nullptr));
    }
    return S_OK;
}

HRESULT CameraMediaStream::StopLocked(bool queueEvent) {
    streamState_ = MF_STREAM_STATE_STOPPED;
    frameReader_.Stop();
    nextSampleTime_ = 0;
    if (queueEvent) {
        WHISPER_RETURN_IF_FAILED(eventQueue_->QueueEventParamVar(
            MEStreamStopped,
            GUID_NULL,
            S_OK,
            nullptr));
    }
    return S_OK;
}

HRESULT CameraMediaStream::CreateSampleLocked(IMFSample** sample) {
    if (!sample) return E_POINTER;
    *sample = nullptr;
    if (sampleAllocator_) return sampleAllocator_->AllocateSample(sample);

    ComPtr<IMFSample> createdSample;
    ComPtr<IMFMediaBuffer> buffer;
    WHISPER_RETURN_IF_FAILED(MFCreateSample(createdSample.ReleaseAndGetAddressOf()));
    WHISPER_RETURN_IF_FAILED(MFCreateMemoryBuffer(kNv12FrameBytes, buffer.ReleaseAndGetAddressOf()));
    WHISPER_RETURN_IF_FAILED(createdSample->AddBuffer(buffer.Get()));
    return createdSample.CopyTo(sample);
}

HRESULT CameraMediaStream::WriteLatestFrameLocked(IMFSample* sample) {
    if (!sample) return E_INVALIDARG;

    const bool hasNewFrame = frameReader_.CopyLatestAfter(lastFrameSequence_, latestFrame_);
    if (hasNewFrame) {
        lastFrameSequence_ = latestFrame_.sequence;
        if (latestFrame_.width != kVideoWidth || latestFrame_.height != kVideoHeight) {
            if (!ScaleNv12Frame(latestFrame_, scaledFrame_)) scaledFrame_.clear();
        } else {
            scaledFrame_.clear();
        }
    }

    const std::vector<std::uint8_t>* frame = &blackFrame_;
    const std::size_t expectedLatestBytes =
        static_cast<std::size_t>(latestFrame_.width) * latestFrame_.height * 3U / 2U;
    if (latestFrame_.width == kVideoWidth
        && latestFrame_.height == kVideoHeight
        && latestFrame_.bytes.size() == kNv12FrameBytes) {
        frame = &latestFrame_.bytes;
    } else if (!scaledFrame_.empty()
        && scaledFrame_.size() == kNv12FrameBytes
        && latestFrame_.bytes.size() == expectedLatestBytes) {
        frame = &scaledFrame_;
    }

    ComPtr<IMFMediaBuffer> buffer;
    WHISPER_RETURN_IF_FAILED(sample->GetBufferByIndex(0, buffer.ReleaseAndGetAddressOf()));

    ComPtr<IMF2DBuffer> twoDimensionalBuffer;
    if (SUCCEEDED(buffer.As(&twoDimensionalBuffer))) {
        return twoDimensionalBuffer->ContiguousCopyFrom(
            frame->data(),
            static_cast<DWORD>(frame->size()));
    }

    BYTE* destination = nullptr;
    DWORD maximumLength = 0;
    DWORD currentLength = 0;
    WHISPER_RETURN_IF_FAILED(buffer->Lock(&destination, &maximumLength, &currentLength));
    (void)currentLength;
    if (maximumLength < frame->size()) {
        buffer->Unlock();
        return HRESULT_FROM_WIN32(ERROR_INSUFFICIENT_BUFFER);
    }
    std::memcpy(destination, frame->data(), frame->size());
    const HRESULT unlockResult = buffer->Unlock();
    WHISPER_RETURN_IF_FAILED(unlockResult);
    return buffer->SetCurrentLength(static_cast<DWORD>(frame->size()));
}

}  // namespace whisper::virtual_camera
