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
        const audioConstraints = {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
        };

        let stream = null;

        // 1. Try system / screen audio first. On Windows this captures the
        //    interviewer's voice via loopback (works even with headphones).
        try {
            stream = await navigator.mediaDevices.getDisplayMedia({
                video: true,
                audio: audioConstraints,
            });
        } catch (err) {
            // Screen capture denied or unsupported (common on macOS) — we'll use the mic.
            console.warn('[AudioCapture] system audio unavailable, falling back to microphone:', err.name, err.message);
        }

        // 2. If there's no audio track yet (macOS has no system-audio loopback, or the
        //    screen prompt was denied), grab the microphone so we can still hear the
        //    interviewer (in-person, or through the speakers on a call).
        if (!stream || stream.getAudioTracks().length === 0) {
            try {
                const mic = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
                if (stream) {
                    mic.getAudioTracks().forEach((t) => stream.addTrack(t));
                } else {
                    stream = mic;
                }
            } catch (micErr) {
                console.error('[AudioCapture] microphone fallback failed:', micErr.name, micErr.message);
                if (!stream) throw micErr; // nothing captured at all — surface the error
            }
        }

        streamRef.current = stream;

        // Setup audio-level analysis
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        audioContextRef.current = audioContext;

        const audioTrack = stream.getAudioTracks()[0];
        if (audioTrack) {
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
        }

        setIsCapturing(true);

        // If we have a screen video track, stop everything when the user ends sharing.
        // (In the microphone-only fallback there is no video track.)
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
