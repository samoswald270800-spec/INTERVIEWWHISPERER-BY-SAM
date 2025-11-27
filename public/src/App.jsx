import React, { useState, useRef, useEffect, useCallback } from 'react';
import StatusPill from './components/StatusPill';
import CommandDock from './components/CommandDock';
import JobDescription from './components/JobDescription';
import QAList from './components/QAList';
import { useAudioCapture } from './hooks/useAudioCapture';

export default function App() {
    // UI State
    const [status, setStatus] = useState("SYSTEM READY");
    const [isListening, setIsListening] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [qaList, setQaList] = useState([]);
    const [isSessionActive, setIsSessionActive] = useState(false);
    const [canExpand, setCanExpand] = useState(false);
    const [isExpanding, setIsExpanding] = useState(false);
    const [jd, setJd] = useState("");
    const [speed, setSpeed] = useState(0); // 0 = INSTANT (blazing fast)

    // WebRTC Refs
    const pcRef = useRef(null);
    const dcRef = useRef(null);
    const streamRef = useRef(null);
    const lastQuestionRef = useRef("");
    const typeQueueRef = useRef([]);
    const isTypingRef = useRef(false);

    // Audio Hook
    const { startCapture, stopCapture, toggleMute, isMuted } = useAudioCapture();

    // --- Typewriter Logic (Instant if speed = 0) ---
    const processTypeQueue = useCallback(() => {
        if (!isTypingRef.current && typeQueueRef.current.length > 0) {
            isTypingRef.current = true;

            // If speed is 0, dump entire queue at once (instant)
            if (speed === 0) {
                const text = typeQueueRef.current.join('');
                typeQueueRef.current = [];

                setQaList(prev => {
                    const newList = [...prev];
                    if (newList.length > 0) {
                        newList[newList.length - 1].answer += text;
                    }
                    return newList;
                });

                isTypingRef.current = false;
            } else {
                // Normal typing with delay
                const char = typeQueueRef.current.shift();

                setQaList(prev => {
                    const newList = [...prev];
                    if (newList.length > 0) {
                        newList[newList.length - 1].answer += char;
                    }
                    return newList;
                });

                setTimeout(() => {
                    isTypingRef.current = false;
                    processTypeQueue();
                }, speed);
            }
        }
    }, [speed]);

    // Trigger typing loop
    useEffect(() => {
        if (typeQueueRef.current.length > 0 && !isTypingRef.current) {
            processTypeQueue();
        }
    }, [speed, processTypeQueue]);

    // --- Realtime Session Logic ---
    const startRealtime = async () => {
        setStatus("CONNECTING...");

        try {
            // 1. Get Ephemeral Token
            const tokenRes = await fetch("/session", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ mode: "smart" })
            });
            const data = await tokenRes.json();

            if (!data.client_secret?.value) {
                setStatus("TOKEN ERROR");
                return;
            }

            // 2. Start Audio Capture
            const stream = await startCapture();
            streamRef.current = stream;

            // 3. Setup WebRTC
            const pc = new RTCPeerConnection();
            pcRef.current = pc;

            // Add Audio Track
            const audioTrack = stream.getAudioTracks()[0];
            pc.addTrack(audioTrack, stream);

            // Setup Data Channel
            const dc = pc.createDataChannel("oai-events");
            dcRef.current = dc;

            dc.onopen = () => {
                setIsSessionActive(true);
                setStatus("LISTENING...");

                // Send Initial Config
                const instructions = buildInstructions("smart");
                const event = {
                    type: "session.update",
                    session: {
                        modalities: ["text"],
                        instructions: instructions,
                        input_audio_transcription: { model: "whisper-1" },
                        turn_detection: { type: "server_vad" }
                    }
                };
                dc.send(JSON.stringify(event));
            };

            dc.onmessage = (e) => handleServerEvent(JSON.parse(e.data));

            // 4. Connect
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);

            const sdpResponse = await fetch(`https://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview`, {
                method: "POST",
                body: offer.sdp,
                headers: {
                    Authorization: `Bearer ${data.client_secret.value}`,
                    "Content-Type": "application/sdp"
                },
            });

            const answerSdp = await sdpResponse.text();
            await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

        } catch (err) {
            console.error(err);
            setStatus("ERROR");
            stopSession();
        }
    };

    const stopSession = () => {
        if (pcRef.current) pcRef.current.close();
        stopCapture();
        setIsSessionActive(false);
        setStatus("STOPPED");
        setIsListening(false);
        setIsProcessing(false);
        setCanExpand(false);
    };

    const handleServerEvent = (event) => {
        const type = event.type;

        if (type === "conversation.item.input_audio_transcription.completed") {
            if (event.transcript) {
                const qText = event.transcript.trim();
                lastQuestionRef.current = qText;
                setCanExpand(true);

                // Add new Q&A card
                setQaList(prev => [...prev, { question: qText, answer: "" }]);
            }
        }
        else if (type === "response.text.delta") {
            // Add to type queue
            for (let char of event.delta) {
                typeQueueRef.current.push(char);
            }
            processTypeQueue();
        }
        else if (type === "input_audio_buffer.speech_started") {
            setStatus("USER SPEAKING");
            setIsListening(true);
        }
        else if (type === "input_audio_buffer.speech_stopped") {
            setStatus("PROCESSING...");
            setIsListening(false);
            setIsProcessing(true);
        }
        else if (type === "response.done") {
            setStatus("LISTENING...");
            setIsProcessing(false);
            setIsExpanding(false);

            // Reset instructions to smart mode if we just finished expanding
            if (isExpanding) {
                sendSessionUpdate("smart");
            }
        }
    };

    // --- Expand Logic ---
    const expandLastAnswer = () => {
        if (!dcRef.current || !lastQuestionRef.current || isExpanding) return;

        setIsExpanding(true);

        // 1. Update Instructions for Expansion
        const expandInstructions = buildInstructions("expand");
        sendSessionUpdate("expand", expandInstructions);

        // 2. Send Fake User Message to Trigger Response
        const event = {
            type: "conversation.item.create",
            item: {
                type: "message",
                role: "user",
                content: [{ type: "input_text", text: `Expand on this: ${lastQuestionRef.current}` }]
            }
        };
        dcRef.current.send(JSON.stringify(event));

        // 3. Request Response
        dcRef.current.send(JSON.stringify({ type: "response.create", response: { modalities: ["text"] } }));

        // Clear last answer to make room for expansion
        setQaList(prev => {
            const newList = [...prev];
            if (newList.length > 0) {
                newList[newList.length - 1].answer = "";
            }
            return newList;
        });
    };

    // --- Helpers ---
    const buildInstructions = (mode) => {
        const GLOBAL = `🔥 GLOBAL RULES\nYou are answering as the candidate in a live job interview.\nSpeak in first person ("I", "my project").\nSound human, conversational, not robotic.\nAnchor answers to: 1. Job Description, 2. Resume.\nUse STAR method implicitly.`.trim();

        const SMART = `--- SMART MODE ---\nConcise, high-quality, 90-120s answers.`;
        const EXPAND = `🔥 EXPANSION MODE (ULTRA-DETAILED)\nYou are expanding your previous answer into much more detail.\n- Minimum 1500 words\n- Full STAR methodology\n- Technical decisions and architecture\n- Business impact with metrics\n- Answer as fresh question (don't mention "expansion")`.trim();

        const modeText = mode === "expand" ? EXPAND : SMART;
        const jdText = jd || "(No JD)";

        return [GLOBAL, modeText, "JD:", jdText].join("\n\n");
    };

    const sendSessionUpdate = (mode, instructionsOverride) => {
        if (!dcRef.current) return;
        const instructions = instructionsOverride || buildInstructions(mode);
        const event = {
            type: "session.update",
            session: { instructions }
        };
        dcRef.current.send(JSON.stringify(event));
    };

    const handleAnalyzeScreen = async () => {
        try {
            const screenStream = await navigator.mediaDevices.getDisplayMedia({
                video: true,
                audio: false
            });

            const track = screenStream.getVideoTracks()[0];
            const imageCapture = new ImageCapture(track);
            const bitmap = await imageCapture.grabFrame();

            const canvas = document.createElement("canvas");
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(bitmap, 0, 0);
            const base64 = canvas.toDataURL("image/jpeg", 0.8);

            track.stop();

            setStatus("ANALYZING...");

            const res = await fetch("/analyze-screen", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ screenshotBase64: base64, mode: "smart" })
            });

            const data = await res.json();
            if (data.analysis) {
                if (dcRef.current) {
                    const event = {
                        type: "conversation.item.create",
                        item: {
                            type: "message",
                            role: "system",
                            content: [{ type: "input_text", text: `[SCREEN CONTEXT]: ${data.analysis}` }]
                        }
                    };
                    dcRef.current.send(JSON.stringify(event));
                }
                setStatus("SCREEN ANALYZED");
                setTimeout(() => setStatus("LISTENING..."), 2000);
            }
        } catch (e) {
            console.error(e);
            setStatus("ANALYSIS FAILED");
        }
    };

    const handleSaveJd = async (newJd) => {
        setJd(newJd);
        if (isSessionActive) {
            sendSessionUpdate("smart");
        }
        return true;
    };

    const handleClear = () => {
        setQaList([]);
        lastQuestionRef.current = "";
        setCanExpand(false);
    };

    const handleLogout = async () => {
        try {
            await fetch('/api/logout', { method: 'POST' });
            window.location.href = '/login';
        } catch (e) {
            console.error('Logout failed:', e);
            window.location.href = '/login';
        }
    };

    return (
        <>
            <div className="void-bg">
                <div className="aurora"></div>
                <div className="noise"></div>
            </div>

            <StatusPill
                status={status}
                isListening={isListening}
                isProcessing={isProcessing}
            />

            <button className="power-btn" onClick={handleLogout} title="Sign Out">
                <svg className="icon" viewBox="0 0 24 24">
                    <path d="M18.36 6.64a9 9 0 1 1-12.73 0"></path>
                    <line x1="12" y1="2" x2="12" y2="12"></line>
                </svg>
            </button>

            <main className="stage">
                <QAList qaList={qaList} />
            </main>

            <CommandDock
                onStart={startRealtime}
                onStop={stopSession}
                onAnalyze={handleAnalyzeScreen}
                onClear={handleClear}
                onMute={toggleMute}
                onExpand={expandLastAnswer}
                isSessionActive={isSessionActive}
                isMuted={isMuted}
                canExpand={canExpand}
                isExpanding={isExpanding}
                speed={speed}
                setSpeed={setSpeed}
            />

            <JobDescription
                jd={jd}
                setJd={setJd}
                onSave={handleSaveJd}
            />
        </>
    );
}
