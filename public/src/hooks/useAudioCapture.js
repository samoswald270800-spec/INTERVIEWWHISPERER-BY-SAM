import { useState, useRef, useCallback } from 'react';

export const useAudioCapture = () => {
    const [isCapturing, setIsCapturing] = useState(false);
    const [isMuted, setIsMuted] = useState(false);
    const [audioLevel, setAudioLevel] = useState(0);

    const streamRef = useRef(null);
    const audioContextRef = useRef(null);
    const analyserRef = useRef(null);
    const animationFrameRef = useRef(null);

    const startCapture = useCallback(async () => {
        // Goal: capture the computer's SYSTEM audio (the interviewer's voice from
        // the video/call) — never the physical microphone.
        //
        // Windows/Linux: getDisplayMedia loopback works natively.
        // macOS: Electron's native loopback is unreliable, so we capture a virtual
        //   audio device (BlackHole / Loopback / an Aggregate device) that carries
        //   the system audio. It shows up as an "input" but only carries what the
        //   system plays — not the real mic.
        const audioTuning = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
        const isMac = /Mac/i.test((typeof navigator !== 'undefined' && (navigator.platform || navigator.userAgent)) || '');

        let stream = null;

        // 1) Native system-audio loopback (Windows/Linux).
        if (!isMac) {
            try {
                stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
                if (stream.getAudioTracks().length === 0) {
                    stream.getTracks().forEach((t) => t.stop());
                    stream = null;
                }
            } catch (err) {
                console.warn('[AudioCapture] loopback failed, trying virtual device:', err.name, err.message);
                stream = null;
            }
        }

        // 2) Virtual audio device (macOS route, or loopback produced no audio).
        if (!stream) {
            // Device labels are hidden until an audio permission is granted once.
            let devices = await navigator.mediaDevices.enumerateDevices();
            if (!devices.some((d) => d.kind === 'audioinput' && d.label)) {
                const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
                probe.getTracks().forEach((t) => t.stop());
                devices = await navigator.mediaDevices.enumerateDevices();
            }
            const virtual = devices.find(
                (d) => d.kind === 'audioinput' && /blackhole|loopback|aggregate|soundflower/i.test(d.label)
            );
            if (!virtual) {
                throw new Error('No system-audio device found. Install BlackHole and route your audio to it, then try again.');
            }
            stream = await navigator.mediaDevices.getUserMedia({
                audio: { deviceId: { exact: virtual.deviceId }, ...audioTuning },
            });
            console.log('[AudioCapture] Capturing system audio via virtual device:', virtual.label);
        }

        streamRef.current = stream;

        // Setup audio-level analysis on the system-audio track
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        audioContextRef.current = audioContext;

        const audioTrack = stream.getAudioTracks()[0];
        const source = audioContext.createMediaStreamSource(new MediaStream([audioTrack]));
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        analyserRef.current = analyser;
        source.connect(analyser);

        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        const updateAudioLevel = () => {
            analyser.getByteFrequencyData(dataArray);
            const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
            setAudioLevel((average / 255) * 100);
            animationFrameRef.current = requestAnimationFrame(updateAudioLevel);
        };
        updateAudioLevel();

        setIsCapturing(true);

        // Stop everything if the user ends the screen share.
        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack) {
            videoTrack.addEventListener('ended', () => stopCapture());
        }

        return stream;
    }, []);

    const stopCapture = useCallback(() => {
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }

        if (audioContextRef.current) {
            audioContextRef.current.close();
            audioContextRef.current = null;
        }

        if (animationFrameRef.current) {
            cancelAnimationFrame(animationFrameRef.current);
            animationFrameRef.current = null;
        }

        setIsCapturing(false);
        setAudioLevel(0);
    }, []);

    const toggleMute = useCallback(() => {
        if (streamRef.current) {
            const audioTrack = streamRef.current.getAudioTracks()[0];
            if (audioTrack) {
                audioTrack.enabled = !audioTrack.enabled;
                setIsMuted(!audioTrack.enabled);
            }
        }
    }, []);

    return {
        isCapturing,
        isMuted,
        audioLevel,
        startCapture,
        stopCapture,
        toggleMute,
    };
};
