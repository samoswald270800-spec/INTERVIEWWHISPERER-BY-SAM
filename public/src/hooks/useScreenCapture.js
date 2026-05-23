/**
 * useScreenCapture — Captures desktop screen frames for remote viewing
 * 
 * Uses desktopCapturer in Electron, getDisplayMedia on web.
 * Captures frames at configurable FPS, compresses to JPEG, sends via callback.
 */

import { useRef, useState, useCallback } from 'react';

const DEFAULT_FPS = 3;
const JPEG_QUALITY = 0.5; // 0-1, lower = smaller frames

export default function useScreenCapture({ onFrame, fps = DEFAULT_FPS }) {
    const [isCapturing, setIsCapturing] = useState(false);
    const streamRef = useRef(null);
    const videoRef = useRef(null);
    const canvasRef = useRef(null);
    const intervalRef = useRef(null);

    const startCapture = useCallback(async () => {
        try {
            let stream;

            // Electron: use desktopCapturer
            if (window.electron?.isElectron) {
                // In Electron, getDisplayMedia should work with desktopCapturer
                stream = await navigator.mediaDevices.getUserMedia({
                    audio: false,
                    video: {
                        mandatory: {
                            chromeMediaSource: 'desktop',
                            minWidth: 1280,
                            maxWidth: 1920,
                            minHeight: 720,
                            maxHeight: 1080,
                        }
                    }
                });
            } else {
                // Web: use getDisplayMedia (user picks screen)
                stream = await navigator.mediaDevices.getDisplayMedia({
                    video: {
                        width: { ideal: 1920, max: 1920 },
                        height: { ideal: 1080, max: 1080 },
                        frameRate: { ideal: fps, max: 5 },
                    },
                    audio: false,
                });
            }

            streamRef.current = stream;

            // Create video element to receive stream
            const video = document.createElement('video');
            video.srcObject = stream;
            video.muted = true;
            await video.play();
            videoRef.current = video;

            // Create canvas for frame extraction
            const canvas = document.createElement('canvas');
            canvasRef.current = canvas;

            // Start frame capture interval
            const interval = 1000 / fps;
            intervalRef.current = setInterval(() => {
                if (!video.videoWidth) return;

                // Scale down for bandwidth
                const scale = Math.min(1, 1280 / video.videoWidth);
                canvas.width = video.videoWidth * scale;
                canvas.height = video.videoHeight * scale;

                const ctx = canvas.getContext('2d');
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

                // Convert to JPEG base64
                const frame = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
                if (onFrame) onFrame(frame);
            }, interval);

            setIsCapturing(true);
            console.log('[ScreenCapture] Started');

            // Handle stream ended (user revoked permission)
            stream.getVideoTracks()[0].addEventListener('ended', () => {
                stopCapture();
            });

        } catch (err) {
            console.error('[ScreenCapture] Failed to start:', err);
            setIsCapturing(false);
        }
    }, [onFrame, fps]);

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
            videoRef.current.srcObject = null;
            videoRef.current = null;
        }
        setIsCapturing(false);
        console.log('[ScreenCapture] Stopped');
    }, []);

    return { isCapturing, startCapture, stopCapture };
}
