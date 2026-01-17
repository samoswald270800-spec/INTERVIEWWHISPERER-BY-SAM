import React, { useState, useRef, useEffect, useCallback } from 'react';
import StatusPill from './components/StatusPill';
import CommandDock from './components/CommandDock';
import JobDescription from './components/JobDescription';
import QAList from './components/QAList';
import SettingsPopover from './components/SettingsPopover';
import { useAudioCapture } from './hooks/useAudioCapture';
import './App.css';

import API_BASE_URL from './config';

const GLOBAL_PROCESSED_EVENTS = new Set();
// Global WebRTC tracking to survive React remounts/HMR
window._lastPC = null;
window._lastDC = null;
window._lastStream = null;

export default function App() {
    const instanceId = useRef(Math.random().toString(36).substring(7));
    console.log(`[App] Mounting instance: ${instanceId.current}`);

    const [status, setStatus] = useState("SYSTEM READY");
    const [isListening, setIsListening] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [qaList, setQaList] = useState([]);
    const [isSessionActive, setIsSessionActive] = useState(false);
    const [canExpand, setCanExpand] = useState(false);
    const [isExpanding, setIsExpanding] = useState(false);
    const [jd, setJd] = useState("");
    const [speed, setSpeed] = useState(0);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [permissions, setPermissions] = useState({ canExpand: true, canAnalyze: true });
    const [visionModel, setVisionModel] = useState("openai");
    const [interviewMode, setInterviewMode] = useState("smart"); // 'smart' | 'hr' | 'technical' | 'vp'
    const [opacity, setOpacity] = useState(1);
    const [credits, setCredits] = useState(0);
    const [remainingTime, setRemainingTime] = useState(0);
    const timerIntervalRef = useRef(null);


    const lastQuestionRef = useRef("");
    const typeQueueRef = useRef([]);
    const isTypingRef = useRef(false);

    const { startCapture, stopCapture, toggleMute, isMuted } = useAudioCapture();

    const processTypeQueue = useCallback(() => {
        if (!isTypingRef.current && typeQueueRef.current.length > 0) {
            isTypingRef.current = true;

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

    useEffect(() => {
        if (typeQueueRef.current.length > 0 && !isTypingRef.current) {
            processTypeQueue();
        }
    }, [speed, processTypeQueue]);

    const formatTime = (seconds) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const stopSession = useCallback(async () => {
        setIsSessionActive(false);
        setStatus("STOPPING...");

        // Call backend to end session and calculate final credits
        try {
            await fetch(`${API_BASE_URL}/session/end`, {
                method: 'POST',
                credentials: 'include',
            });
        } catch (e) {
            console.warn('Failed to end session on backend:', e);
        }

        // Cleanup WebRTC resources
        if (window._lastDC) {
            window._lastDC.close();
            window._lastDC = null;
        }
        if (window._lastPC) {
            window._lastPC.close();
            window._lastPC = null;
        }
        if (window._lastStream) {
            window._lastStream.getTracks().forEach(t => t.stop());
            window._lastStream = null;
        }

        stopCapture();
        setStatus("SESSION ENDED");
        setIsListening(false);
        setIsProcessing(false);
        setCanExpand(false);

        // Re-fetch credits to sync final balance with backend
        fetchCredits();
    }, [stopCapture]);

    const fetchCredits = async () => {
        try {
            const res = await fetch(`${API_BASE_URL}/api/me`, { credentials: 'include' });
            if (!res.ok) throw new Error("Failed to fetch info");
            const data = await res.json();

            if (data.permissions) setPermissions(data.permissions);
            if (data.credits !== undefined) {
                setCredits(data.credits);
                setRemainingTime(data.credits * 60);
            }
        } catch (err) {
            console.error("Fetch credits error:", err);
            setStatus("NETWORK ERROR");
        }
    };

    // Initialize: Permissions, Credits, Opacity
    useEffect(() => {
        fetchCredits();

        // Load persisted opacity
        const savedOpacity = localStorage.getItem('app_opacity');
        if (savedOpacity) {
            const val = parseFloat(savedOpacity);
            setOpacity(val);
            if (window.electron && window.electron.setOpacity) {
                window.electron.setOpacity(val);
            }
        }
    }, []);

    // Countdown timer
    useEffect(() => {
        if (isSessionActive && remainingTime > 0) {
            timerIntervalRef.current = setInterval(() => {
                setRemainingTime(prev => {
                    if (prev <= 1) {
                        clearInterval(timerIntervalRef.current);
                        stopSession();
                        return 0;
                    }
                    return prev - 1;
                });
            }, 1000);
        } else {
            if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
        }
        return () => { if (timerIntervalRef.current) clearInterval(timerIntervalRef.current); };
    }, [isSessionActive]);

    const isStartingRef = useRef(false);

    const startRealtime = async () => {
        if (isSessionActive || isStartingRef.current) return;
        isStartingRef.current = true;

        // NUCLEAR CLEANUP: Kill any lingering global connections before starting
        if (window._lastPC) {
            console.log("[Nuclear] Closing previous zombie PC");
            try { window._lastPC.close(); } catch (e) { }
            window._lastPC = null;
        }
        if (window._lastDC) {
            console.log("[Nuclear] Closing previous zombie DC");
            try { window._lastDC.close(); } catch (e) { }
            window._lastDC = null;
        }
        if (window._lastStream) {
            try { window._lastStream.getTracks().forEach(t => t.stop()); } catch (e) { }
            window._lastStream = null;
        }

        try {
            setStatus("REQUESTING ACCESS...");

            // 1. Get Media Permissions FIRST (Prevents credit charge if denied)
            const audioStream = await startCapture();
            if (!audioStream) {
                isStartingRef.current = false;
                setStatus("PERMISSION DENIED");
                return;
            }
            window._lastStream = audioStream;

            setStatus("STARTING SESSION...");
            setQaList([]);
            lastQuestionRef.current = "";
            typeQueueRef.current = [];
            isTypingRef.current = false;

            // 2. Fetch session token (Deducts credits)
            const res = await fetch(`${API_BASE_URL}/session`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ mode: 'smart', interviewMode })
            });

            if (!res.ok) {
                const errData = await res.json();
                if (errData.error && errData.error.includes('credit')) {
                    alert("Insufficient credits. Please top up your account.");
                    setStatus("INSUFFICIENT CREDITS");
                } else {
                    setStatus("ERROR");
                }
                isStartingRef.current = false;
                stopCapture(); // Cleanup the stream we just got
                return;
            }

            const data = await res.json();
            const EPHEMERAL_KEY = data.client_secret.value;

            // Setup WebRTC peer connection
            const pc = new RTCPeerConnection();
            window._lastPC = pc;

            // Add audio tracks
            audioStream.getTracks().forEach(track => pc.addTrack(track, audioStream));

            // Setup data channel
            const dc = pc.createDataChannel("oai-events");
            window._lastDC = dc;

            dc.addEventListener("open", () => {
                console.log("DATA CHANNEL OPENED");
                setStatus("LISTENING...");
                setIsSessionActive(true);
                isStartingRef.current = false;
                // Fetch credits immediately after session starts to sync UI
                fetchCredits();
            });

            dc.addEventListener("close", () => {
                isStartingRef.current = false;
            });

            dc.onmessage = (e) => {
                try {
                    const event = JSON.parse(e.data);
                    handleServerEvent(event);
                } catch (err) {
                    console.error("DC message parse error:", err);
                }
            };

            // Create and set local offer
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);

            // Send offer to OpenAI, get answer
            const sdpRes = await fetch("https://api.openai.com/v1/realtime", {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${EPHEMERAL_KEY}`,
                    "Content-Type": "application/sdp"
                },
                body: offer.sdp
            });

            const answerSdp = await sdpRes.text();
            await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

        } catch (e) {
            console.error("startRealtime error:", e);
            setStatus("START FAILED");
            isStartingRef.current = false;
            stopCapture();
        }
    };

    // Removal of local processedEventIds ref

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (window._lastPC) window._lastPC.close();
            if (window._lastDC) window._lastDC.close();
            stopCapture();
        };
    }, []);

    const handleServerEvent = (event) => {
        const type = event.type;
        const eventId = event.event_id;

        // Prevent processing the same event twice globally
        if (eventId && GLOBAL_PROCESSED_EVENTS.has(eventId)) {
            return;
        }
        if (eventId) {
            GLOBAL_PROCESSED_EVENTS.add(eventId);
            if (GLOBAL_PROCESSED_EVENTS.size > 2000) {
                const arr = Array.from(GLOBAL_PROCESSED_EVENTS);
                const newSet = new Set(arr.slice(1000));
                GLOBAL_PROCESSED_EVENTS.clear();
                newSet.forEach(id => GLOBAL_PROCESSED_EVENTS.add(id));
            }
        }

        if (type === "input_audio_buffer.speech_started") {
            setStatus("USER SPEAKING");
            setIsListening(true);
        }
        else if (type === "input_audio_buffer.speech_stopped") {
            setStatus("PROCESSING...");
            setIsListening(false);
            setIsProcessing(true);

            // CRITICAL FIX: Create card NOW before answer arrives
            typeQueueRef.current = [];
            isTypingRef.current = false;
            setQaList(prev => [...prev, { question: "Processing...", answer: "" }]);
        }
        else if (type === "conversation.item.input_audio_transcription.completed") {
            if (event.transcript) {
                const qText = event.transcript.trim();
                lastQuestionRef.current = qText;
                setCanExpand(true);

                // Update question in existing card
                setQaList(prev => {
                    const newList = [...prev];
                    if (newList.length > 0) {
                        newList[newList.length - 1].question = qText;
                    }
                    return newList;
                });
            }
        }
        else if (type === "response.text.delta") {
            for (let char of event.delta) {
                typeQueueRef.current.push(char);
            }
            processTypeQueue();
        }
        else if (type === "response.done") {
            setStatus("LISTENING...");
            setIsProcessing(false);
            setIsExpanding(false);

            if (isExpanding) {
                sendSessionUpdate("smart");
            }
        }
    };

    const expandLastAnswer = () => {
        if (!window._lastDC || !lastQuestionRef.current || isExpanding) return;

        setIsExpanding(true);

        const expandInstructions = buildInstructions("expand");
        sendSessionUpdate("expand", expandInstructions);

        const event = {
            type: "conversation.item.create",
            item: {
                type: "message",
                role: "user",
                content: [{ type: "input_text", text: `Expand on this: ${lastQuestionRef.current}` }]
            }
        };
        window._lastDC.send(JSON.stringify(event));

        window._lastDC.send(JSON.stringify({ type: "response.create", response: { modalities: ["text"] } }));

        setQaList(prev => {
            const newList = [...prev];
            if (newList.length > 0) {
                newList[newList.length - 1].answer = "";
            }
            return newList;
        });
    };

    const buildInstructions = (mode) => {
        const GLOBAL = `🔥 GLOBAL RULES\nYou are answering as the candidate in a live job interview.\nSpeak in first person ("I", "my project").\nSound human, conversational, not robotic.\nAnchor answers to: 1. Job Description, 2. Resume.\nUse STAR method implicitly.`.trim();

        const SMART = `--- SMART MODE ---\nConcise, high-quality, 90-120s answers.`;
        const EXPAND = `🔥 EXPANSION MODE (ULTRA-DETAILED)\nYou are expanding your previous answer into much more detail.\n- Minimum 1500 words\n- Full STAR methodology\n- Technical decisions and architecture\n- Business impact with metrics\n- Answer as fresh question (don't mention "expansion")`.trim();

        const modeText = mode === "expand" ? EXPAND : SMART;
        const jdText = jd || "(No JD)";

        return [GLOBAL, modeText, "JD:", jdText].join("\n\n");
    };

    const sendSessionUpdate = (mode, instructionsOverride) => {
        if (!window._lastDC) return;
        const instructions = instructionsOverride || buildInstructions(mode);
        const event = {
            type: "session.update",
            session: { instructions }
        };
        window._lastDC.send(JSON.stringify(event));
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

            const res = await fetch(`${API_BASE_URL}/analyze-screen`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: 'include',
                body: JSON.stringify({
                    screenshotBase64: base64,
                    mode: "smart",
                    preferredModel: visionModel
                })
            });

            const data = await res.json();
            if (data.error) {
                alert(data.error);
                setStatus("LISTENING...");
                return;
            }
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
            await fetch(`${API_BASE_URL}/api/logout`, {
                method: 'POST',
                credentials: 'include'
            });
            window.location.href = '/login';
        } catch (e) {
            console.error('Logout failed:', e);
            window.location.href = '/login';
        }
    };

    const handleOpacityChange = (val) => {
        setOpacity(val);
        localStorage.setItem('app_opacity', val); // Persist
        if (window.electron && window.electron.setOpacity) {
            window.electron.setOpacity(val);
        }
    };

    return (
        <div className="app-container">
            <div className="void-bg">
                <div className="aurora"></div>
                <div className="noise"></div>
            </div>

            {/* Session Info - Timer & Credits */}
            <div className="session-info">
                <div className="session-timer">
                    <span className="label">Time Left</span>
                    <span className={`value timer ${remainingTime < 300 ? 'warning' : ''}`}>
                        {formatTime(remainingTime)}
                    </span>
                </div>
                <div className="session-credits">
                    <span className="label">Credits</span>
                    <span className="value">{credits} min</span>
                </div>
            </div>

            <div className="status-pill-wrapper">
                <StatusPill
                    status={status}
                    isListening={isListening}
                    isProcessing={isProcessing}
                />
            </div>

            <button className="power-btn" onClick={handleLogout} title="Sign Out">
                <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                    <polyline points="16 17 21 12 16 7"></polyline>
                    <line x1="21" y1="12" x2="9" y2="12"></line>
                </svg>
            </button>

            <button
                className={`settings-btn ${isSettingsOpen ? 'active' : ''}`}
                onClick={() => setIsSettingsOpen(!isSettingsOpen)}
                title="Preferences"
            >
                <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="4" y1="21" x2="4" y2="14"></line>
                    <line x1="4" y1="10" x2="4" y2="3"></line>
                    <line x1="12" y1="21" x2="12" y2="12"></line>
                    <line x1="12" y1="8" x2="12" y2="3"></line>
                    <line x1="20" y1="21" x2="20" y2="16"></line>
                    <line x1="20" y1="12" x2="20" y2="3"></line>
                    <line x1="1" y1="14" x2="7" y2="14"></line>
                    <line x1="9" y1="8" x2="15" y2="8"></line>
                    <line x1="17" y1="16" x2="23" y2="16"></line>
                </svg>
            </button>

            <SettingsPopover
                isOpen={isSettingsOpen}
                speed={speed}
                setSpeed={setSpeed}
                visionModel={visionModel}
                setVisionModel={setVisionModel}
                interviewMode={interviewMode}
                setInterviewMode={setInterviewMode}
                opacity={opacity}
                setOpacity={handleOpacityChange}
                isElectron={window.electron && window.electron.isElectron}
            />

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
                canExpand={canExpand && permissions.canExpand}
                isExpanding={isExpanding}
                canAnalyze={permissions.canAnalyze}
            />

            <JobDescription
                jd={jd}
                setJd={setJd}
                onSave={handleSaveJd}
            />
        </div>
    );
}
