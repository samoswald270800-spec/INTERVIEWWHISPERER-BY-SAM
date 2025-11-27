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
        try {
            const stream = await navigator.mediaDevices.getDisplayMedia({
                video: true,
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                },
            });

            streamRef.current = stream;

            // Setup audio analysis
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            audioContextRef.current = audioContext;

            const audioTrack = stream.getAudioTracks()[0];
            if (audioTrack) {
                const source = audioContext.createMediaStreamSource(new MediaStream([audioTrack]));
                const analyser = audioContext.createAnalyser();
                analyser.fftSize = 256;
                analyserRef.current = analyser;
                source.connect(analyser);

                // Start monitoring audio levels
                const dataArray = new Uint8Array(analyser.frequencyBinCount);
                const updateAudioLevel = () => {
                    analyser.getByteFrequencyData(dataArray);
                    const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
                    setAudioLevel((average / 255) * 100);
                    animationFrameRef.current = requestAnimationFrame(updateAudioLevel);
                };
                updateAudioLevel();
            }

            setIsCapturing(true);

            // Handle stream end
            stream.getVideoTracks()[0].addEventListener('ended', () => {
                stopCapture();
            });

            return stream;
        } catch (error) {
            console.error('Error starting capture:', error);
            throw error;
        }
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
