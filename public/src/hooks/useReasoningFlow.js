/**
 * useReasoningFlow.js
 * 
 * Implements the full Reasoning Architecture loop:
 *   1. VAD-based auto-listening (silence detection via AnalyserNode)
 *   2. Audio → Whisper transcription (/api/reasoning/transcribe)
 *   3. Transcript → GPT SSE streaming (/api/reasoning/answer)
 *   4. Auto-restart listening after answer completes
 *
 * No manual record button required — fully automatic like Live mode,
 * but using discrete HTTP steps for deeper reasoning answers.
 */

import { useRef, useCallback } from 'react';
import API_BASE_URL from '../config';

// --- VAD Configuration ---
const SILENCE_THRESHOLD = 8;        // Out of 255 — volume below this = "silence"
const SILENCE_DURATION_MS = 1500;   // 1.5 seconds of silence triggers stop
const MIN_AUDIO_BYTES = 1024;       // Drop audio blobs smaller than 1KB (static pops)
const CHUNK_INTERVAL_MS = 250;      // MediaRecorder chunk interval

// --- Whisper Hallucination Filter ---
const HALLUCINATIONS = new Set([
    "thank you", "thanks", "okay", "ok", "bye", "goodbye",
    "you", "thank you for watching", "thanks for watching",
    "thank you very much", "the end", "so", "um", "uh",
    "hmm", "huh", "yeah", "yes", "no", "right",
    "i don't know", "please subscribe", "like and subscribe",
    "subtitles by the amara.org community", "sous-titres réalisés",
]);

/**
 * @param {Object} opts
 * @param {Function} opts.setStatus        - status string setter
 * @param {Function} opts.setIsListening   - listening state setter
 * @param {Function} opts.setIsProcessing  - processing state setter
 * @param {Function} opts.setQaList        - QA list setter
 * @param {Function} opts.setCanExpand     - expand ability setter
 * @param {Function} opts.setIsRecording   - recording state setter (for visual feedback)
 * @param {Object}   opts.lastQuestionRef  - ref to store last question text
 * @param {Object}   opts.lastAnswerRef    - ref to store last answer text (for expand)
 * @param {Object}   opts.typeQueueRef     - ref to the character typing queue
 * @param {Object}   opts.isTypingRef      - ref for typing lock
 * @param {Function} opts.processTypeQueue - function to flush type queue to React
 * @param {Function} opts.getJd            - function returning current JD text
 * @param {Function} opts.getInterviewMode - function returning current interview mode
 * @param {Function} opts.isSessionActiveRef - ref to check if session is still active
 * @param {Function} [opts.consumeSteering] - returns (and clears) the queued
 *                    steering note to ride along with the next answer, or null
 */
export function useReasoningFlow({
    setStatus,
    setIsListening,
    setIsProcessing,
    setQaList,
    setCanExpand,
    setIsRecording,
    lastQuestionRef,
    lastAnswerRef,
    typeQueueRef,
    isTypingRef,
    processTypeQueue,
    getJd,
    getInterviewMode,
    isSessionActiveRef,
    consumeSteering = null,
}) {
    // --- Internal refs ---
    const streamRef = useRef(null);           // MediaStream from getUserMedia / getDisplayMedia
    const mediaRecorderRef = useRef(null);    // MediaRecorder instance
    const audioChunksRef = useRef([]);        // Accumulated audio blobs
    const audioContextRef = useRef(null);     // AudioContext for VAD
    const analyserRef = useRef(null);         // AnalyserNode for volume
    const vadFrameRef = useRef(null);         // requestAnimationFrame ID
    const silenceStartRef = useRef(null);     // timestamp when silence began
    const isListeningRef = useRef(false);     // internal guard
    const abortControllerRef = useRef(null);  // for aborting SSE fetch

    // ─────────────────────────────────────────────
    //  START: Grab mic and begin VAD loop
    // ─────────────────────────────────────────────
    const startListening = useCallback(async () => {
        if (isListeningRef.current) return;
        if (!isSessionActiveRef.current) return;

        isListeningRef.current = true;
        setIsListening(true);
        setIsRecording(true);
        setStatus("LISTENING...");
        silenceStartRef.current = null;

        try {
            // If we already have a stream, reuse it (don't prompt user again)
            if (!streamRef.current || streamRef.current.getTracks().every(t => t.readyState === 'ended')) {
                const stream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl: true,
                    }
                });
                streamRef.current = stream;
            }

            // --- AudioContext + AnalyserNode for VAD ---
            if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
                audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
            }
            const audioCtx = audioContextRef.current;
            const source = audioCtx.createMediaStreamSource(streamRef.current);
            const analyser = audioCtx.createAnalyser();
            analyser.fftSize = 256;
            source.connect(analyser);
            analyserRef.current = analyser;

            // --- MediaRecorder ---
            const mediaRecorder = new MediaRecorder(streamRef.current);
            mediaRecorderRef.current = mediaRecorder;
            audioChunksRef.current = [];

            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    audioChunksRef.current.push(e.data);
                }
            };

            mediaRecorder.onstop = () => {
                // Stitch chunks into a single blob and process
                const blob = new Blob(audioChunksRef.current, { type: mediaRecorder.mimeType || 'audio/webm' });
                audioChunksRef.current = [];
                handleAudioComplete(blob);
            };

            // Start recording in 250ms chunks
            mediaRecorder.start(CHUNK_INTERVAL_MS);

            // --- VAD: 60fps volume monitor ---
            const dataArray = new Uint8Array(analyser.frequencyBinCount);

            const vadLoop = () => {
                if (!isListeningRef.current) return;

                analyser.getByteFrequencyData(dataArray);
                const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;

                if (average < SILENCE_THRESHOLD) {
                    // Silence detected
                    if (!silenceStartRef.current) {
                        silenceStartRef.current = Date.now();
                    } else if (Date.now() - silenceStartRef.current > SILENCE_DURATION_MS) {
                        // Silence sustained → stop recording, trigger transcription
                        console.log('[Reasoning VAD] Silence detected, stopping recorder');
                        isListeningRef.current = false;
                        setIsListening(false);
                        setIsRecording(false);

                        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
                            mediaRecorderRef.current.stop();
                        }
                        // Cancel the VAD loop
                        return;
                    }
                } else {
                    // Voice activity — reset silence timer
                    silenceStartRef.current = null;
                }

                vadFrameRef.current = requestAnimationFrame(vadLoop);
            };

            vadFrameRef.current = requestAnimationFrame(vadLoop);

        } catch (err) {
            console.error('[Reasoning] Failed to start listening:', err);
            setStatus("MIC ACCESS DENIED");
            isListeningRef.current = false;
            setIsListening(false);
            setIsRecording(false);
        }
    }, [setStatus, setIsListening, setIsRecording, processTypeQueue]);

    // ─────────────────────────────────────────────
    //  HANDLE AUDIO COMPLETE: Validate → Transcribe → Answer
    // ─────────────────────────────────────────────
    const handleAudioComplete = useCallback(async (blob) => {
        // 1. Validate minimum size (reject static pops)
        if (blob.size < MIN_AUDIO_BYTES) {
            console.log(`[Reasoning] Audio too small (${blob.size}B), re-listening...`);
            setStatus("LISTENING...");
            startListening();
            return;
        }

        setStatus("TRANSCRIBING...");
        setIsProcessing(true);

        try {
            // 2. Send to Whisper
            const formData = new FormData();
            formData.append('audio', blob, 'speech.webm');

            const transcribeRes = await fetch(`${API_BASE_URL}/api/reasoning/transcribe`, {
                method: 'POST',
                credentials: 'include',
                body: formData,
            });

            if (!transcribeRes.ok) {
                throw new Error(`Transcribe failed: ${transcribeRes.status}`);
            }

            const { transcript } = await transcribeRes.json();

            // 3. Hallucination check
            if (!transcript || isHallucination(transcript)) {
                console.log(`[Reasoning] Hallucination or empty transcript: "${transcript}", re-listening...`);
                setStatus("LISTENING...");
                setIsProcessing(false);
                startListening();
                return;
            }

            console.log(`[Reasoning] Valid transcript: "${transcript}"`);

            // 4. Create QA card and stream answer
            lastQuestionRef.current = transcript;
            setQaList(prev => [...prev, {
                question: transcript,
                answer: "",
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            }]);
            setStatus("THINKING...");

            await streamAnswer(transcript);

        } catch (err) {
            console.error('[Reasoning] Transcription/answer error:', err);
            setStatus("ERROR");
            setIsProcessing(false);
            // Re-listen after a short delay
            if (isSessionActiveRef.current) {
                setTimeout(() => startListening(), 2000);
            }
        }
    }, [setStatus, setIsProcessing, setQaList]);

    // ─────────────────────────────────────────────
    //  STREAM ANSWER: SSE from /api/reasoning/answer
    // ─────────────────────────────────────────────
    const streamAnswer = useCallback(async (transcript, expandPrompt = null) => {
        setStatus(expandPrompt ? "EXPANDING..." : "GENERATING...");

        const controller = new AbortController();
        abortControllerRef.current = controller;

        let fullAnswer = "";

        // Queued steering nudges ride along with normal answers only (not expand).
        // They are sent as a separate field so the displayed question stays clean.
        const steering = !expandPrompt && consumeSteering ? consumeSteering() : null;

        try {
            const res = await fetch(`${API_BASE_URL}/api/reasoning/answer`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                signal: controller.signal,
                body: JSON.stringify({
                    transcript: expandPrompt || transcript,
                    interviewMode: getInterviewMode(),
                    jd: getJd(),
                    steering: steering || undefined,
                }),
            });

            if (!res.ok) {
                throw new Error(`Answer request failed: ${res.status}`);
            }

            // Parse SSE stream
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });

                // Process complete SSE lines
                const lines = buffer.split('\n');
                buffer = lines.pop(); // Keep incomplete line in buffer

                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;

                    const jsonStr = line.slice(6); // Remove "data: " prefix
                    try {
                        const event = JSON.parse(jsonStr);
                        if (event.type === 'delta' && event.delta) {
                            // Push characters into type queue
                            for (const char of event.delta) {
                                typeQueueRef.current.push(char);
                            }
                            fullAnswer += event.delta;
                            processTypeQueue();
                        } else if (event.type === 'done') {
                            console.log('[Reasoning] Stream complete');
                        } else if (event.type === 'error') {
                            console.error('[Reasoning] Stream error:', event.error);
                        }
                    } catch (parseErr) {
                        // Ignore malformed SSE lines
                    }
                }
            }

            // Save answer for expand feature
            if (lastAnswerRef) {
                lastAnswerRef.current = fullAnswer;
            }

            setCanExpand(true);
            setIsProcessing(false);
            setStatus("LISTENING...");

            // Auto-restart listening
            if (isSessionActiveRef.current) {
                startListening();
            }

        } catch (err) {
            if (err.name === 'AbortError') {
                console.log('[Reasoning] Stream aborted');
            } else {
                console.error('[Reasoning] Stream error:', err);
                setStatus("ERROR");
            }
            setIsProcessing(false);

            if (isSessionActiveRef.current) {
                setTimeout(() => startListening(), 2000);
            }
        }
    }, [setStatus, setIsProcessing, setCanExpand, processTypeQueue, getJd, getInterviewMode, consumeSteering]);

    // ─────────────────────────────────────────────
    //  EXPAND: Re-answer with deeper prompt
    // ─────────────────────────────────────────────
    const expandLastAnswer = useCallback(async () => {
        if (!lastQuestionRef.current || !lastAnswerRef?.current) return;

        // Stop listening while expanding
        stopListening();

        setCanExpand(false);
        setIsProcessing(true);

        // Clear the current answer and regenerate
        setQaList(prev => {
            const newList = [...prev];
            if (newList.length > 0) {
                newList[newList.length - 1] = { ...newList[newList.length - 1], answer: "" };
            }
            return newList;
        });

        typeQueueRef.current = [];
        isTypingRef.current = false;

        const expandPrompt = `The question was: ${lastQuestionRef.current}\nThe answer was: ${lastAnswerRef.current}\nNow EXPAND this into a much fuller, deeper response. Minimum 1,200 words. Add tradeoffs, technical nuances, real-world examples. Do not mention you are expanding.`;

        await streamAnswer(lastQuestionRef.current, expandPrompt);
    }, [setCanExpand, setIsProcessing, setQaList, streamAnswer]);

    // ─────────────────────────────────────────────
    //  STOP LISTENING: Kill VAD, recorder, context
    // ─────────────────────────────────────────────
    const stopListening = useCallback(() => {
        isListeningRef.current = false;
        setIsListening(false);
        setIsRecording(false);

        if (vadFrameRef.current) {
            cancelAnimationFrame(vadFrameRef.current);
            vadFrameRef.current = null;
        }

        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
            try {
                mediaRecorderRef.current.stop();
            } catch (e) { /* already stopped */ }
        }
        mediaRecorderRef.current = null;
    }, [setIsListening, setIsRecording]);

    // ─────────────────────────────────────────────
    //  CLEANUP: Full teardown (called on session stop)
    // ─────────────────────────────────────────────
    const cleanup = useCallback(() => {
        stopListening();

        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }

        if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
            audioContextRef.current.close();
            audioContextRef.current = null;
        }

        if (streamRef.current) {
            streamRef.current.getTracks().forEach(t => t.stop());
            streamRef.current = null;
        }

        audioChunksRef.current = [];
    }, [stopListening]);

    // ─────────────────────────────────────────────
    //  HELPERS
    // ─────────────────────────────────────────────
    function isHallucination(text) {
        const cleaned = text.toLowerCase().trim().replace(/[.,!?]/g, '');

        // 1. Exact match against known hallucinations
        if (HALLUCINATIONS.has(cleaned)) return true;

        // 2. Too short without a question mark (likely noise)
        const words = cleaned.split(/\s+/);
        if (words.length < 3 && !cleaned.includes('?')) return true;

        return false;
    }

    return {
        startListening,
        stopListening,
        cleanup,
        expandLastAnswer,
    };
}
