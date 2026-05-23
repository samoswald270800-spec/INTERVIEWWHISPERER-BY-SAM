/**
 * useScreenCapture — Captures desktop screen frames for remote viewing
 * 
 * Uses getDisplayMedia for both Electron and web.
 * Electron auto-approves via setDisplayMediaRequestHandler in electron-main.js.
 * Captures frames at configurable FPS, compresses to JPEG, sends via callback.
 */

import { useRef, useState, useCallback } from 'react';

const DEFAULT_FPS = 10; // 10 FPS = ultra-smooth, 100ms between frames
const JPEG_QUALITY = 0.3; // Lower quality offsets 2x more frames for bandwidth

export default function useScreenCapture({ onFrame, fps = DEFAULT_FPS }) {
    const [isCapturing, setIsCapturing] = useState(false);
    const streamRef = useRef(null);
    const videoRef = useRef(null);
    const canvasRef = useRef(null);
    const intervalRef = useRef(null);
    const onFrameRef = useRef(onFrame);
    onFrameRef.current = onFrame; // Always keep latest callback

    const startCapture = useCallback(async () => {
        // Prevent double-start
        if (streamRef.current) return;

        try {
            // getDisplayMedia works in both Electron and web browsers.
            // Electron auto-approves via setDisplayMediaRequestHandler in electron-main.js
            // (selects primary screen automatically, no user prompt).
            const stream = await navigator.mediaDevices.getDisplayMedia({
                video: {
                    width: { ideal: 1920, max: 1920 },
                    height: { ideal: 1080, max: 1080 },
                    frameRate: { ideal: fps, max: 5 },
                },
                audio: false,
            });

            streamRef.current = stream;

            // Create hidden video element to receive stream
            const video = document.createElement('video');
            video.srcObject = stream;
            video.muted = true;
            video.playsInline = true;
            await video.play();
            videoRef.current = video;

            // Create canvas for frame extraction
            const canvas = document.createElement('canvas');
            canvasRef.current = canvas;

            // Start frame capture interval
            const interval = 1000 / fps;
            intervalRef.current = setInterval(() => {
                if (!video.videoWidth || video.readyState < 2) return;

                // Scale down for bandwidth efficiency
                const scale = Math.min(1, 1280 / video.videoWidth);
                canvas.width = Math.round(video.videoWidth * scale);
                canvas.height = Math.round(video.videoHeight * scale);

                const ctx = canvas.getContext('2d');
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

                // Convert to JPEG base64
                const frame = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
                if (onFrameRef.current) onFrameRef.current(frame);
            }, interval);

            setIsCapturing(true);
            console.log('[ScreenCapture] Started — streaming at', fps, 'FPS');

            // Handle stream ended (user revoked permission or display disconnected)
            stream.getVideoTracks()[0].addEventListener('ended', () => {
                console.log('[ScreenCapture] Stream ended externally');
                stopCapture();
            });

        } catch (err) {
            console.error('[ScreenCapture] Failed to start:', err.name, err.message);
            setIsCapturing(false);
        }
    }, [fps]); // onFrame accessed via ref, not closure

    const stopCapture = useCallback(() => {
        if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
        }
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(t => t.stop());
            streamRef.current = null;
        }
        if (videoRef.current) {
            videoRef.current.pause();
            videoRef.current.srcObject = null;
            videoRef.current = null;
        }
        setIsCapturing(false);
        console.log('[ScreenCapture] Stopped');
    }, []);

    return { isCapturing, startCapture, stopCapture };
}
