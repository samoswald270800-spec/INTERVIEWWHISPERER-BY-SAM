/**
 * useScreenCapture — Captures the desktop screen for remote viewing.
 *
 * Acquires a single getDisplayMedia stream and exposes it via `onStream` so the
 * caller can feed it into a WebRTC peer connection (the primary, high-FPS path).
 *
 * The legacy MJPEG encoder (canvas.toDataURL over the socket) is NOT started
 * automatically — it is only spun up via `startMjpegFallback()` when WebRTC
 * fails to connect, reusing the same stream so the screen is never captured twice.
 */

import { useRef, useState, useCallback } from 'react';

const MJPEG_FPS = 8;
const MJPEG_QUALITY = 0.4;
const MJPEG_MAX_WIDTH = 960;

export default function useScreenCapture({ onFrame, onStream, mjpegFps = MJPEG_FPS }) {
    const [isCapturing, setIsCapturing] = useState(false);
    const streamRef = useRef(null);
    const videoRef = useRef(null);
    const canvasRef = useRef(null);
    const timerRef = useRef(null);
    const onFrameRef = useRef(onFrame);
    onFrameRef.current = onFrame;
    const onStreamRef = useRef(onStream);
    onStreamRef.current = onStream;

    const stopMjpeg = useCallback(() => {
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
        if (videoRef.current) { videoRef.current.pause(); videoRef.current.srcObject = null; videoRef.current = null; }
    }, []);

    const stopCapture = useCallback(() => {
        stopMjpeg();
        if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; }
        setIsCapturing(false);
    }, [stopMjpeg]);

    const startCapture = useCallback(async () => {
        if (streamRef.current) return streamRef.current;

        try {
            const videoConstraints = {
                width: { ideal: 1920, max: 1920 },
                height: { ideal: 1080, max: 1080 },
                frameRate: { ideal: 30, max: 60 },
            };

            // Include the machine's system audio so the operator can also HEAR it
            // (works on Windows via loopback). If audio can't be captured (e.g.
            // macOS loopback), fall back to video-only so the screen share still works.
            let stream;
            try {
                stream = await navigator.mediaDevices.getDisplayMedia({ video: videoConstraints, audio: true });
            } catch (audioErr) {
                console.warn('[ScreenCapture] audio+video failed, retrying video-only:', audioErr.name, audioErr.message);
                stream = await navigator.mediaDevices.getDisplayMedia({ video: videoConstraints, audio: false });
            }

            streamRef.current = stream;
            setIsCapturing(true);

            stream.getVideoTracks()[0].addEventListener('ended', () => {
                console.log('[ScreenCapture] Stream ended externally');
                stopCapture();
            });

            // Hand the raw stream to the caller (WebRTC host)
            if (onStreamRef.current) onStreamRef.current(stream);

            console.log('[ScreenCapture] Stream acquired (WebRTC primary)');
            return stream;
        } catch (err) {
            console.error('[ScreenCapture] Failed to start:', err.name, err.message);
            setIsCapturing(false);
            return null;
        }
    }, [stopCapture]);

    // Fallback: encode JPEG frames from the existing stream and push them over the socket.
    const startMjpegFallback = useCallback(() => {
        const stream = streamRef.current;
        if (!stream || timerRef.current) return;

        const video = document.createElement('video');
        video.srcObject = stream;
        video.muted = true;
        video.playsInline = true;
        video.play().catch(() => {});
        videoRef.current = video;

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvasRef.current = canvas;

        const interval = 1000 / mjpegFps;
        timerRef.current = setInterval(() => {
            if (!video.videoWidth || video.readyState < 2) return;

            const scale = Math.min(1, MJPEG_MAX_WIDTH / video.videoWidth);
            const w = Math.round(video.videoWidth * scale);
            const h = Math.round(video.videoHeight * scale);

            if (canvas.width !== w) canvas.width = w;
            if (canvas.height !== h) canvas.height = h;

            ctx.drawImage(video, 0, 0, w, h);
            const frame = canvas.toDataURL('image/jpeg', MJPEG_QUALITY);
            if (onFrameRef.current) onFrameRef.current(frame);
        }, interval);

        console.warn(`[ScreenCapture] MJPEG fallback active — ${mjpegFps} FPS (WebRTC unavailable)`);
    }, [mjpegFps]);

    return { isCapturing, startCapture, startMjpegFallback, stopCapture };
}
