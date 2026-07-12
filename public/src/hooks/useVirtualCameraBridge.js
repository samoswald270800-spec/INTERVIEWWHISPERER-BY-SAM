import { useCallback, useEffect, useRef, useState } from 'react';

const TARGET_FPS = 60;

export default function useVirtualCameraBridge(candidateStream) {
    const [status, setStatus] = useState(null);
    const [running, setRunning] = useState(false);
    const [error, setError] = useState('');
    const runningRef = useRef(false);
    const readerRef = useRef(null);

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

    const stop = useCallback(async () => {
        runningRef.current = false;
        try { await readerRef.current?.cancel(); } catch { /* reader already closed */ }
        readerRef.current = null;
        await window.electron?.virtualCamera?.stop?.().catch(() => {});
        setRunning(false);
    }, []);

    useEffect(() => () => { stop(); }, [stop]);

    const start = useCallback(async () => {
        setError('');
        const currentStatus = await refreshStatus();
        if (!candidateStream?.getVideoTracks().length) {
            setError('Candidate video is not connected.');
            return false;
        }
        if (!currentStatus?.bridgeReady || !currentStatus?.driverInstalled) {
            setError(currentStatus?.message || 'The signed Windows virtual camera component is not installed.');
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

        const track = candidateStream.getVideoTracks()[0];
        const processor = new MediaStreamTrackProcessor({ track });
        const reader = processor.readable.getReader();
        readerRef.current = reader;
        runningRef.current = true;
        setRunning(true);

        const pump = async () => {
            while (runningRef.current) {
                const { done, value: frame } = await reader.read();
                if (done || !frame) break;
                try {
                    let format = 'NV12';
                    let copyOptions = { format };
                    let size;
                    try {
                        size = frame.allocationSize(copyOptions);
                    } catch {
                        format = frame.format;
                        copyOptions = undefined;
                        size = frame.allocationSize();
                    }
                    const bytes = new Uint8Array(size);
                    const layout = await frame.copyTo(bytes, copyOptions);
                    window.electron.virtualCamera.sendFrame({
                        format,
                        width: frame.codedWidth,
                        height: frame.codedHeight,
                        timestamp: frame.timestamp || 0,
                        layout: layout.map((plane) => ({ offset: plane.offset, stride: plane.stride })),
                        data: bytes,
                    });
                } catch (frameError) {
                    console.warn('[VirtualCamera] frame copy failed:', frameError.message);
                } finally {
                    frame.close();
                }
            }
        };

        pump().catch((pumpError) => {
            if (runningRef.current) setError(pumpError.message || 'Virtual camera frame pump stopped.');
            stop();
        });
        return true;
    }, [candidateStream, refreshStatus, stop]);

    return { status, running, error, start, stop, refreshStatus };
}
