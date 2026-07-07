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
        // Capture ONLY the computer's system audio — the interviewer's voice coming
        // from the video/call. No microphone. The screen video track is just the
        // required vehicle for loopback audio; we don't send it anywhere meaningful.
        let stream;
        try {
            stream = await navigator.mediaDevices.getDisplayMedia({
                video: true,
                audio: true,
            });
        } catch (err) {
            // Surface the real error name (NotAllowedError = permission,
            // NotReadableError = capture couldn't start) to aid diagnosis.
            throw new Error(`${err.name || 'CaptureError'}: ${err.message || 'could not start capture'}`);
        }

        // There must be a system-audio track. If not, this build/OS can't capture
        // system audio (e.g. old build, or Screen Recording / Audio not allowed).
        if (stream.getAudioTracks().length === 0) {
            stream.getTracks().forEach((t) => t.stop());
            throw new Error('No system audio captured. Use the latest build and allow Screen Recording + Audio for the app.');
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
