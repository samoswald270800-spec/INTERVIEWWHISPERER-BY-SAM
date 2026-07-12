import { useCallback, useEffect, useRef, useState } from 'react';

const TARGET_FPS = 30;
const DIRECT_COPY_FRAME_FORMATS = new Set(['I420', 'NV12']);

export default function useVirtualCameraBridge(candidateStream) {
    const [status, setStatus] = useState(null);
    const [running, setRunning] = useState(false);
    const [installing, setInstalling] = useState(false);
    const [error, setError] = useState('');
    const runningRef = useRef(false);
    const readerRef = useRef(null);
    const frameReadyRef = useRef(true);
    const usesFrameAcknowledgementsRef = useRef(false);
    const unsubscribeFrameReadyRef = useRef(null);
    const lastForwardedTimestampRef = useRef(0);
    const autoStartTrackIdRef = useRef('');
    const bridgedTrackIdRef = useRef('');
    const startInFlightRef = useRef(false);

    const refreshStatus = useCallback(async () => {
        if (!window.electron?.virtualCamera?.getStatus) {
            const browserStatus = {
                supported: false,
                bridgeReady: false,
                driverInstalled: false,
                message: 'Open the superadmin dashboard in the Windows desktop app.',
            };
            setStatus(browserStatus);
            return browserStatus;
        }

        try {
            const next = await window.electron.virtualCamera.getStatus();
            setStatus(next);
            return next;
        } catch {
            const unavailable = { supported: false, message: 'Virtual camera status is unavailable.' };
            setStatus(unavailable);
            return unavailable;
        }
    }, []);

    useEffect(() => { refreshStatus(); }, [refreshStatus]);

    const install = useCallback(async () => {
        if (!window.electron?.virtualCamera?.install) {
            setError('Open this control in the Windows desktop app.');
            return false;
        }
        setInstalling(true);
        setError('');
        try {
            const result = await window.electron.virtualCamera.install();
            const nextStatus = result?.status || await refreshStatus();
            setStatus(nextStatus);
            if (!result?.ok) setError(result?.message || 'Virtual camera installation did not complete.');
            return Boolean(result?.ok);
        } catch (installError) {
            setError(installError.message || 'Virtual camera installation failed.');
            return false;
        } finally {
            setInstalling(false);
        }
    }, [refreshStatus]);

    const stop = useCallback(async () => {
        runningRef.current = false;
        try { await readerRef.current?.cancel(); } catch { /* reader already closed */ }
        readerRef.current = null;
        unsubscribeFrameReadyRef.current?.();
        unsubscribeFrameReadyRef.current = null;
        frameReadyRef.current = true;
        usesFrameAcknowledgementsRef.current = false;
        lastForwardedTimestampRef.current = 0;
        bridgedTrackIdRef.current = '';
        await window.electron?.virtualCamera?.stop?.().catch(() => {});
        setRunning(false);
    }, []);

    useEffect(() => () => { stop(); }, [stop]);

    const start = useCallback(async () => {
        if (runningRef.current) return true;
        if (startInFlightRef.current) return false;
        startInFlightRef.current = true;
        setError('');
        let bridgeStarted = false;
        try {
            const currentStatus = await refreshStatus();
            const track = candidateStream?.getVideoTracks()[0];
            if (!track || track.readyState !== 'live') {
                setError('Candidate video is not connected.');
                return false;
            }
            if (!currentStatus?.bridgeReady || !currentStatus?.driverInstalled) {
                setError(currentStatus?.message || 'The Windows virtual camera component is not installed.');
                return false;
            }
            if (!globalThis.MediaStreamTrackProcessor) {
                setError('This Electron version cannot provide the low-latency video frame processor.');
                return false;
            }

            const result = await window.electron.virtualCamera.start({ width: 1280, height: 720, fps: TARGET_FPS });
            if (!result?.ok) {
                setError(result?.message || 'Virtual camera could not be started.');
                return false;
            }
            bridgeStarted = true;

            const processor = new MediaStreamTrackProcessor({ track });
            const reader = processor.readable.getReader();
            readerRef.current = reader;
            runningRef.current = true;
            bridgedTrackIdRef.current = track.id;
            frameReadyRef.current = true;
            lastForwardedTimestampRef.current = 0;
            usesFrameAcknowledgementsRef.current = typeof window.electron.virtualCamera.onFrameReady === 'function';
            if (usesFrameAcknowledgementsRef.current) {
                unsubscribeFrameReadyRef.current = window.electron.virtualCamera.onFrameReady(() => {
                    frameReadyRef.current = true;
                });
            }
            setRunning(true);

            const pump = async () => {
                const minimumFrameIntervalUs = 1_000_000 / TARGET_FPS;
                while (runningRef.current) {
                    const { done, value: frame } = await reader.read();
                    if (done || !frame) break;
                    try {
                        const timestamp = Number(frame.timestamp) || Math.round(performance.now() * 1000);
                        const previousTimestamp = lastForwardedTimestampRef.current;
                        if (previousTimestamp && timestamp - previousTimestamp < minimumFrameIntervalUs * 0.9) continue;
                        if (usesFrameAcknowledgementsRef.current && !frameReadyRef.current) continue;

                        let format = frame.format;
                        let copyOptions;
                        let size;
                        if (DIRECT_COPY_FRAME_FORMATS.has(format)) {
                            size = frame.allocationSize();
                        } else {
                            format = 'NV12';
                            copyOptions = { format };
                            size = frame.allocationSize(copyOptions);
                        }
                        const bytes = new Uint8Array(size);
                        const layout = await frame.copyTo(bytes, copyOptions);
                        if (usesFrameAcknowledgementsRef.current) frameReadyRef.current = false;
                        window.electron.virtualCamera.sendFrame({
                            format,
                            width: frame.codedWidth,
                            height: frame.codedHeight,
                            timestamp,
                            layout: layout.map((plane) => ({ offset: plane.offset, stride: plane.stride })),
                            data: bytes,
                        });
                        lastForwardedTimestampRef.current = timestamp;
                    } catch (frameError) {
                        frameReadyRef.current = true;
                        console.warn('[VirtualCamera] frame copy failed:', frameError.message);
                    } finally {
                        frame.close();
                    }
                }
            };

            pump().then(() => {
                if (!runningRef.current) return;
                setError('Candidate video stream ended.');
                void stop();
            }).catch((pumpError) => {
                if (!runningRef.current) return;
                setError(pumpError.message || 'Virtual camera frame pump stopped.');
                void stop();
            });
            return true;
        } catch (startError) {
            setError(startError.message || 'Virtual camera could not be started.');
            if (bridgeStarted) await stop();
            return false;
        } finally {
            startInFlightRef.current = false;
        }
    }, [candidateStream, refreshStatus, stop]);

    useEffect(() => {
        const track = candidateStream?.getVideoTracks()[0];
        if (!track) {
            autoStartTrackIdRef.current = '';
            if (runningRef.current) void stop();
            return undefined;
        }

        if (runningRef.current
            && bridgedTrackIdRef.current
            && bridgedTrackIdRef.current !== track.id) {
            void stop();
        }
        const handleEnded = () => {
            if (autoStartTrackIdRef.current === track.id) autoStartTrackIdRef.current = '';
            if (bridgedTrackIdRef.current === track.id) void stop();
        };
        track.addEventListener('ended', handleEnded);
        return () => track.removeEventListener('ended', handleEnded);
    }, [candidateStream, stop]);

    useEffect(() => {
        const track = candidateStream?.getVideoTracks()[0];
        if (!window.electron?.virtualCamera?.start
            || !status?.driverInstalled
            || !track
            || track.readyState !== 'live'
            || installing
            || running
            || runningRef.current
            || autoStartTrackIdRef.current === track.id) {
            return;
        }

        autoStartTrackIdRef.current = track.id;
        void start();
    }, [candidateStream, installing, running, start, status?.driverInstalled]);

    useEffect(() => {
        if (!running) return undefined;
        let checking = false;
        const timer = setInterval(async () => {
            if (checking) return;
            checking = true;
            const next = await refreshStatus();
            checking = false;
            if (runningRef.current && !next?.bridgeRunning) {
                setError(next?.bridge?.error || 'The virtual camera bridge stopped unexpectedly.');
                void stop();
            }
        }, 1000);
        return () => clearInterval(timer);
    }, [refreshStatus, running, stop]);

    return { status, running, installing, error, install, start, stop, refreshStatus };
}
