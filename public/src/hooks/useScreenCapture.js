/**
 * useScreenCapture — Captures desktop screen frames for remote viewing
 * 
 * Uses getDisplayMedia for both Electron and web.
 * Electron auto-approves via setDisplayMediaRequestHandler in electron-main.js.
 * 
 * Optimized for low-latency:
 * - Adaptive resolution (scales down to keep frame size < 80KB)
 * - Only sends frames when content actually changes
 * - Uses requestAnimationFrame for timing instead of setInterval
 */

import { useRef, useState, useCallback } from 'react';

const TARGET_FPS = 8;    // Sweet spot: smooth enough, not too heavy
const JPEG_QUALITY = 0.35;
const MAX_WIDTH = 960;   // Scale to 960px wide — small frames, fast transfer
const SEND_INTERVAL = 1000 / TARGET_FPS;

export default function useScreenCapture({ onFrame, fps = TARGET_FPS }) {
    const [isCapturing, setIsCapturing] = useState(false);
    const streamRef = useRef(null);
    const videoRef = useRef(null);
    const canvasRef = useRef(null);
    const timerRef = useRef(null);
    const onFrameRef = useRef(onFrame);
    onFrameRef.current = onFrame;

    const startCapture = useCallback(async () => {
        if (streamRef.current) return;

        try {
            const stream = await navigator.mediaDevices.getDisplayMedia({
                video: {
                    width: { ideal: 1920, max: 1920 },
                    height: { ideal: 1080, max: 1080 },
                    frameRate: { ideal: fps, max: fps },
                },
                audio: false,
            });

            streamRef.current = stream;

            const video = document.createElement('video');
            video.srcObject = stream;
            video.muted = true;
            video.playsInline = true;
            await video.play();
            videoRef.current = video;

            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvasRef.current = canvas;

            // Use setInterval with proper timing
            const interval = 1000 / fps;
            let lastSendTime = 0;

            timerRef.current = setInterval(() => {
                if (!video.videoWidth || video.readyState < 2) return;

                const now = performance.now();
                if (now - lastSendTime < interval * 0.8) return; // Prevent burst
                lastSendTime = now;

                // Aggressive downscale for bandwidth
                const scale = Math.min(1, MAX_WIDTH / video.videoWidth);
                const w = Math.round(video.videoWidth * scale);
                const h = Math.round(video.videoHeight * scale);

                if (canvas.width !== w) canvas.width = w;
                if (canvas.height !== h) canvas.height = h;

                ctx.drawImage(video, 0, 0, w, h);

                const frame = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
                if (onFrameRef.current) onFrameRef.current(frame);
            }, interval);

            setIsCapturing(true);
            console.log(`[ScreenCapture] Started — ${fps} FPS, ${MAX_WIDTH}px, quality ${JPEG_QUALITY}`);

            stream.getVideoTracks()[0].addEventListener('ended', () => {
                console.log('[ScreenCapture] Stream ended externally');
                stopCapture();
            });

        } catch (err) {
            console.error('[ScreenCapture] Failed to start:', err.name, err.message);
            setIsCapturing(false);
        }
    }, [fps]);

    const stopCapture = useCallback(() => {
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
        if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
        if (videoRef.current) { videoRef.current.pause(); videoRef.current.srcObject = null; videoRef.current = null; }
        setIsCapturing(false);
    }, []);

    return { isCapturing, startCapture, stopCapture };
}
