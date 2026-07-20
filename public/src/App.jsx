import React, { useState, useRef, useEffect, useCallback } from 'react';
import StatusPill from './components/StatusPill';
import CommandDock from './components/CommandDock';
import JobDescription from './components/JobDescription';
import QAList from './components/QAList';
import SteerBar from './components/SteerBar';
import SettingsPopover from './components/SettingsPopover';
import { useAudioCapture } from './hooks/useAudioCapture';
import { useReasoningFlow } from './hooks/useReasoningFlow';
import HistoryDrawer from './components/HistoryDrawer';
import SuperAdminWorkspace from './components/SuperAdminWorkspace';
import AdminDashboard from './components/AdminDashboard';
import CameraOverlayTile from './components/CameraOverlayTile';
import useSocket from './hooks/useSocket';
import useCandidateCameraSession from './hooks/useCandidateCameraSession';
import UserHelpButton from './components/UserHelpButton';
import CandidateCameraPage from './components/CandidateCameraPage';
import ScreenInsight from './components/ScreenInsight';
import ProfilePage from './components/ProfilePage';
import './App.css';

import API_BASE_URL from './config';

const GLOBAL_PROCESSED_EVENTS = new Set();

// Offline fallback for the "Steer the next answer" suggestion chips when the
// /api/steer-suggestions endpoint is unavailable. Derives simple nudges from
// the JD and the latest completed answer.
function heuristicSteerChips(jd, qaList) {
    const chips = [];
    const jdMetric = (jd || '').match(/\b\d+(?:\.\d+)?\s?%(?:\s?[A-Za-z]{2,8})?|\b\d+\+?\s?(?:years?|yrs)\b/i);
    if (jdMetric) chips.push(`Mention the ${jdMetric[0].trim()} from the JD`);
    const lastDone = [...qaList].reverse().find(t => t.answer && t.question !== 'Processing...');
    if (lastDone && !/\d/.test(lastDone.answer)) chips.push('Add a concrete metric');
    if (qaList.length >= 2) chips.push('Tie it back to an earlier answer');
    return chips.slice(0, 3);
}
// Global WebRTC tracking to survive React remounts/HMR
window._lastPC = null;
window._lastDC = null;
window._lastStream = null;

function InterviewApp() {
    const instanceId = useRef(Math.random().toString(36).substring(7));
    console.log(`[App] Mounting instance: ${instanceId.current}`);

    const [status, setStatus] = useState("SYSTEM READY");
    const [isListening, setIsListening] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [qaList, setQaList] = useState([]);
    const [isSessionActive, setIsSessionActive] = useState(false);
    const [isRecording, setIsRecording] = useState(false);
    const [canExpand, setCanExpand] = useState(false);
    const [isExpanding, setIsExpanding] = useState(false);
    const [jd, setJd] = useState("");
    const [speed, setSpeed] = useState(0);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    // Screen-analysis insight panel (right gutter during the interview)
    const [insight, setInsight] = useState(null);
    const [insightLoading, setInsightLoading] = useState(false);
    const [insightOpen, setInsightOpen] = useState(false);
    const [permissions, setPermissions] = useState({ canExpand: true, canAnalyze: true, canReasoning: true, canTurbo: true, canStartSession: true });
    const [lockedFeatures, setLockedFeatures] = useState({});
    const [visionModel, setVisionModel] = useState("openai");
    const [interviewMode, setInterviewMode] = useState("smart"); // 'smart' | 'hr' | 'technical' | 'vp'
    const [architecture, setArchitecture] = useState("live"); // 'live' | 'reasoning' | 'turbo'
    const [opacity, setOpacity] = useState(1);
    const [credits, setCredits] = useState(0);
    const [remainingTime, setRemainingTime] = useState(0);
    const [unlimitedCredits, setUnlimitedCredits] = useState(false);
    const [orgCode, setOrgCode] = useState(null);
    const [elapsedSeconds, setElapsedSeconds] = useState(0);
    const timerIntervalRef = useRef(null);

    // History State
    const [history, setHistory] = useState([]);

    // Left-edge drawer: 'history' | 'jd' | null
    const [panel, setPanel] = useState(null);

    // "Steer the next answer": queued nudges + conversation-aware suggestions
    const [nudges, setNudges] = useState([]);
    const nudgesRef = useRef([]);
    const [steerSuggestions, setSteerSuggestions] = useState([]);
    const steerFetchingRef = useRef(false);

    // Candidate camera overlay tile (superadmin only)
    const [camOverlayOn, setCamOverlayOn] = useState(false);

    // Role-based rendering
    const [userRole, setUserRole] = useState(null);
    const [isAppLoading, setIsAppLoading] = useState(true);

    // ── Profile view + candidate theming (accent + light/dark) ──
    // Shares localStorage keys with the login page so the two stay in sync.
    const [view, setView] = useState('console'); // 'console' | 'profile'
    const [profileMounted, setProfileMounted] = useState(false);
    const [username, setUsername] = useState('');
    const [accent, setAccentState] = useState(() => {
        try {
            const a = localStorage.getItem('iw_accent');
            return ['violet', 'cyan', 'ember', 'mono'].includes(a) ? a : 'ember';
        } catch { return 'ember'; }
    });
    const [theme, setThemeState] = useState(() => {
        try { return localStorage.getItem('iw_theme') === 'light' ? 'light' : 'dark'; } catch { return 'dark'; }
    });
    const [profileToast, setProfileToast] = useState(null);
    const profileToastTimer = useRef(null);

    const applyAccent = (a) => { setAccentState(a); try { localStorage.setItem('iw_accent', a); } catch { /* ignore */ } };
    const applyTheme = (t) => { setThemeState(t); try { localStorage.setItem('iw_theme', t); } catch { /* ignore */ } };
    const showProfileToast = (msg) => {
        setProfileToast(msg);
        clearTimeout(profileToastTimer.current);
        profileToastTimer.current = setTimeout(() => setProfileToast(null), 2400);
    };
    const openProfile = () => { setProfileMounted(true); setView('profile'); };

    // Candidate app only: apply accent + light/dark to <html>. Admin and
    // super-admin consoles are intentionally left on their default look.
    useEffect(() => {
        const root = document.documentElement;
        if (userRole === 'user') {
            root.setAttribute('data-accent', accent);
            root.setAttribute('data-theme', theme);
        } else {
            root.removeAttribute('data-accent');
            root.removeAttribute('data-theme');
        }
    }, [userRole, accent, theme]);

    // Socket.IO for user-side remote control (only for user role)
    const socket = useSocket(userRole === 'user');

    // Candidate camera session (shared by the overlay tile + dashboard card)
    const camera = useCandidateCameraSession(userRole === 'super_admin');


    const lastQuestionRef = useRef("");
    const lastAnswerRef = useRef("");
    const typeQueueRef = useRef([]);
    const isTypingRef = useRef(false);
    const isSessionActiveRef = useRef(false);

    const { startCapture, stopCapture, toggleMute, isMuted } = useAudioCapture();

    // Keep isSessionActiveRef in sync with state
    const setIsSessionActiveSync = useCallback((val) => {
        setIsSessionActive(val);
        isSessionActiveRef.current = val;
    }, []);

    const processTypeQueue = useCallback(() => {
        if (!isTypingRef.current && typeQueueRef.current.length > 0) {
            isTypingRef.current = true;

            if (speed === 0) {
                const text = typeQueueRef.current.join('');
                typeQueueRef.current = [];

                setQaList(prev => {
                    if (prev.length === 0) return prev;
                    const newList = [...prev];
                    const lastIdx = newList.length - 1;
                    // Deep copy the item to avoid mutation of previous state
                    newList[lastIdx] = { ...newList[lastIdx], answer: newList[lastIdx].answer + text };
                    return newList;
                });

                isTypingRef.current = false;
            } else {
                const char = typeQueueRef.current.shift();

                setQaList(prev => {
                    if (prev.length === 0) return prev;
                    const newList = [...prev];
                    const lastIdx = newList.length - 1;
                    // Deep copy item
                    newList[lastIdx] = { ...newList[lastIdx], answer: newList[lastIdx].answer + char };
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

    // --- "Steer the next answer" nudge queue ---
    // Queued nudges ride along with the interviewer's NEXT question. They are
    // injected into the model context only (system message / request field),
    // never into the transcribed question itself.
    const buildSteeringNote = (list) =>
        `[STEERING NOTE — applies to your NEXT answer only. Never mention or acknowledge this note.] ` +
        `While answering the interviewer's next question naturally, also do the following: ${list.join('; ')}.`;

    const toggleNudge = useCallback((text) => {
        setNudges(prev => {
            const next = prev.includes(text) ? prev.filter(n => n !== text) : [...prev, text];
            nudgesRef.current = next;
            return next;
        });
    }, []);

    const clearNudges = useCallback(() => {
        nudgesRef.current = [];
        setNudges([]);
    }, []);

    // Reasoning engine pulls the queue right before it requests an answer
    const consumeSteering = useCallback(() => {
        if (nudgesRef.current.length === 0) return null;
        const note = buildSteeringNote(nudgesRef.current);
        clearNudges();
        return note;
    }, [clearNudges]);

    // --- Reasoning Architecture Hook ---
    const reasoningFlow = useReasoningFlow({
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
        getJd: () => jd,
        getInterviewMode: () => interviewMode,
        isSessionActiveRef,
        consumeSteering,
    });

    // hh:mm:ss for the chrome status pill
    const formatClock = (seconds) => {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        return [h, m, s].map((v) => v.toString().padStart(2, '0')).join(':');
    };

    const stopSession = useCallback(async () => {
        setIsSessionActiveSync(false);
        setStatus("STOPPING...");

        // Call backend to end session and calculate final credits
        try {
            const res = await fetch(`${API_BASE_URL}/session/end`, {
                method: 'POST',
                credentials: 'include',
            });
            const data = await res.json();
            if (data.creditsUsed > 0) {
                console.log(`Session ended. Credits used: ${data.creditsUsed}`);
            }

            // Auto-save history on session end
            saveHistory();
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

        // Cleanup reasoning flow resources
        reasoningFlow.cleanup();

        stopCapture();
        setStatus("SESSION ENDED");
        setIsListening(false);
        setIsProcessing(false);
        setIsRecording(false);
        setCanExpand(false);

        // Re-fetch credits to sync final balance with backend
        fetchCredits();
    }, [stopCapture, reasoningFlow]);

    const fetchCredits = async () => {
        try {
            const res = await fetch(`${API_BASE_URL}/api/me`, { credentials: 'include' });
            // Session gone/expired/kicked: bounce to the login page instead of
            // showing a stale, unusable logged-in UI (the "reopen" bug).
            if (res.status === 401) {
                window.location.href = '/login';
                return;
            }
            if (!res.ok) throw new Error("Failed to fetch info");
            const data = await res.json();

            // Set role for conditional rendering
            if (data.role) setUserRole(data.role);
            if (data.userId) setUsername(data.userId);
            setIsAppLoading(false);

            if (data.orgCode) setOrgCode(data.orgCode);
            if (data.permissions) setPermissions(data.permissions);
            if (data.lockedFeatures) setLockedFeatures(data.lockedFeatures);
            const hasUnlimitedCredits = data.unlimitedCredits === true;
            setUnlimitedCredits(hasUnlimitedCredits);
            if (hasUnlimitedCredits) {
                setCredits(0);
                setRemainingTime(0);
            } else if (data.credits !== undefined) {
                setCredits(data.credits);
                // Architecture-aware: Live = 6 mins/credit, Turbo = 3 mins/credit
                const minsPerCredit = architecture === 'turbo' ? 3 : 6;
                setRemainingTime(data.credits * minsPerCredit * 60);
            }
        } catch (err) {
            console.error("Fetch credits error:", err);
            setIsAppLoading(false);
            setStatus("NETWORK ERROR");
        }
    };

    const fetchHistory = async () => {
        try {
            const res = await fetch(`${API_BASE_URL}/api/user/history`, { credentials: 'include' });
            const data = await res.json();
            if (data.ok) {
                setHistory(data.history || []);
            }
        } catch (e) {
            console.error("Failed to fetch history:", e);
        }
    };

    const saveHistory = async (nameOverride) => {
        // A session is only blank if it has NO job description AND no Q&A history.
        // We use && instead of || because users might do an interview without a JD.
        if (!jd && qaList.length === 0) return;

        try {
            const name = nameOverride || `Interview ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
            await fetch(`${API_BASE_URL}/api/user/history`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    name,
                    resume_text: "",
                    jd_text: jd,
                    qa_list: qaList,
                    settings: { visionModel, interviewMode, speed }
                })
            });
            fetchHistory(); // Refresh list
        } catch (e) {
            console.error("Failed to save history:", e);
        }
    };

    const deleteHistoryItem = async (id) => {
        try {
            await fetch(`${API_BASE_URL}/api/user/history/${id}`, {
                method: 'DELETE',
                credentials: 'include'
            });
            fetchHistory();
        } catch (e) {
            console.error("Failed to delete history:", e);
        }
    };

    const loadHistoryItem = (item) => {
        // Load item state
        setStatus("HISTORY LOADED");
        setJd(item.jd_text || "");
        setQaList(item.qa_list || []);
        if (item.settings) {
            if (item.settings.interviewMode) setInterviewMode(item.settings.interviewMode);
            if (item.settings.visionModel) setVisionModel(item.settings.visionModel);
            if (item.settings.speed !== undefined) setSpeed(item.settings.speed);
        }
        // stopSession(); // Optional: Ensure no active session
    };

    const handleNewInterview = async () => {
        await saveHistory();
        // Clear State
        setQaList([]);
        setJd("");
        // Reset valid refs if needed
        setStatus("SYSTEM READY");
    };

    // Initialize: Permissions, Credits, Opacity, History, and load saved JD
    useEffect(() => {
        fetchCredits();
        fetchHistory();

        // Load saved JD from backend (so JD persists across sessions)
        fetch(`${API_BASE_URL}/get-jd`, { credentials: 'include' })
            .then(r => r.json())
            .then(data => {
                if (data.jd && !jd) setJd(data.jd);
            }).catch(() => {});

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

    // Auto-sync JD to backend (debounced) so server always has the latest JD
    useEffect(() => {
        const timer = setTimeout(() => {
            if (jd) {
                fetch(`${API_BASE_URL}/set-jd`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ jd }),
                }).catch(() => {});
            }
        }, 2000); // 2s debounce
        return () => clearTimeout(timer);
    }, [jd]);

    // Countdown timer (architecture-aware: Turbo = 2x burn rate)
    useEffect(() => {
        if (isSessionActive && !unlimitedCredits && remainingTime > 0) {
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
    }, [isSessionActive, credits, architecture, unlimitedCredits]);

    // Elapsed session clock for unlimited accounts (nothing to count down)
    useEffect(() => {
        if (!isSessionActive || !unlimitedCredits) return undefined;
        setElapsedSeconds(0);
        const interval = setInterval(() => setElapsedSeconds((prev) => prev + 1), 1000);
        return () => clearInterval(interval);
    }, [isSessionActive, unlimitedCredits]);

    // Keyboard shortcuts: S start/stop, M mute, Esc closes drawers/popovers.
    // (D switches views; handled by the superadmin console shell.)
    useEffect(() => {
        const onKey = (event) => {
            const tag = event.target && event.target.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || event.target?.isContentEditable) return;
            const key = event.key.toLowerCase();
            if (key === 'escape') {
                setPanel(null);
                setIsSettingsOpen(false);
            } else if (key === 's') {
                if (isSessionActive) stopSession();
                else startSessionRouter();
            } else if (key === 'm' && isSessionActive) {
                toggleMute();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    });

    // Refresh the steer-suggestion chips whenever an answer finishes (and once
    // at session start). LLM endpoint first, local heuristics as fallback.
    useEffect(() => {
        if (!isSessionActive || isProcessing) return;
        if (steerFetchingRef.current) return;
        steerFetchingRef.current = true;

        const turns = qaList
            .filter(t => t.answer && t.question !== 'Processing...')
            .slice(-4)
            .map(t => ({ q: t.question, a: t.answer.slice(0, 500) }));

        fetch(`${API_BASE_URL}/api/steer-suggestions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ jd, turns }),
        })
            .then(r => r.json())
            .then(data => {
                if (Array.isArray(data.suggestions) && data.suggestions.length > 0) {
                    setSteerSuggestions(data.suggestions.slice(0, 3));
                } else {
                    setSteerSuggestions(heuristicSteerChips(jd, qaList));
                }
            })
            .catch(() => setSteerSuggestions(heuristicSteerChips(jd, qaList)))
            .finally(() => { steerFetchingRef.current = false; });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isSessionActive, isProcessing, qaList.length]);

    // Stale nudges don't carry across session boundaries
    useEffect(() => {
        clearNudges();
        if (!isSessionActive) setSteerSuggestions([]);
    }, [isSessionActive, clearNudges]);

    // Preferences popover closes on outside click
    useEffect(() => {
        if (!isSettingsOpen) return undefined;
        const onPointerDown = (e) => {
            if (e.target.closest('.prefs-popover') || e.target.closest('.prefs-btn')) return;
            setIsSettingsOpen(false);
        };
        document.addEventListener('pointerdown', onPointerDown, true);
        return () => document.removeEventListener('pointerdown', onPointerDown, true);
    }, [isSettingsOpen]);

    const isStartingRef = useRef(false);
    const mediaRecorderRef = useRef(null);
    const audioChunksRef = useRef([]);
    const classicAudioElRef = useRef(null);

    const startSessionRouter = async () => {
        if (architecture === "reasoning") {
            // Reasoning is temporarily disabled (under development). The engine
            // picker also blocks selecting it; this is a defensive guard.
            setStatus("REASONING — UNDER DEVELOPMENT");
            return;
        }
        // 'live' and 'turbo' both use the realtime WebRTC pipeline
        await startRealtime();
    };

    const startReasoningPipeline = async () => {
        if (isSessionActive || isStartingRef.current) return;
        isStartingRef.current = true;

        try {
            setStatus("INITIALIZING REASONING...");

            // Start credit session on the backend
            const sessRes = await fetch(`${API_BASE_URL}/session/start`, {
                method: 'POST',
                credentials: 'include',
            });
            if (!sessRes.ok) {
                const errData = await sessRes.json().catch(() => ({}));
                throw new Error(errData.error || 'Failed to start session');
            }

            setQaList([]);
            lastQuestionRef.current = "";
            lastAnswerRef.current = "";
            typeQueueRef.current = [];
            isTypingRef.current = false;

            setIsSessionActiveSync(true);
            isStartingRef.current = false;
            fetchCredits();

            // Start the auto-listening VAD loop
            reasoningFlow.startListening();

        } catch (e) {
            console.error("startReasoningPipeline error:", e);
            setStatus(e.message || "START FAILED");
            isStartingRef.current = false;
        }
    };

    // toggleRecording is no longer needed — reasoning uses auto-VAD
    const toggleRecording = () => {};

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
                body: JSON.stringify({ mode: 'smart', interviewMode, architecture })
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                const errMsg = errData.error || `Server error (${res.status})`;
                if (errMsg.includes('credit')) {
                    alert("Insufficient credits. Please top up your account.");
                    setStatus("INSUFFICIENT CREDITS");
                } else {
                    alert(`Session error: ${errMsg}`);
                    setStatus(`ERROR: ${errMsg.substring(0, 40)}`);
                }
                isStartingRef.current = false;
                stopCapture();
                return;
            }

            const data = await res.json();
            const EPHEMERAL_KEY = data.client_secret.value;

            // Setup WebRTC peer connection
            const pc = new RTCPeerConnection();
            window._lastPC = pc;

            // Add ONLY the audio track. getDisplayMedia also returns a video track
            // (needed to capture system audio on some platforms), but the realtime
            // API is audio-only — negotiating a video track is wasteful and can
            // muddy the connection.
            audioStream.getAudioTracks().forEach(track => pc.addTrack(track, audioStream));

            // Setup data channel
            const dc = pc.createDataChannel("oai-events");
            window._lastDC = dc;

            dc.addEventListener("open", () => {
                console.log("DATA CHANNEL OPENED");
                setStatus("LISTENING...");
                setIsSessionActiveSync(true);
                isStartingRef.current = false;

                // Send session.update with full instructions + search_web tool (matches online)
                //
                // NOTE: This MUST use the GA Realtime schema (nested `audio.input`,
                // `output_modalities`) to match the session the backend created via
                // /client_secrets. The old beta schema (`modalities`,
                // top-level `input_audio_transcription`/`turn_detection`) is silently
                // rejected by a GA session, which left transcription unconfigured
                // (auto-detected language → gibberish) and the tools/instructions
                // never applied. Transcription is pinned to English here too.
                const instructions = buildInstructions("smart");
                const sessionUpdateEvent = {
                    type: "session.update",
                    session: {
                        type: "realtime",
                        output_modalities: ["text"],
                        instructions: instructions,
                        audio: {
                            input: {
                                transcription: { model: "gpt-4o-transcribe", language: "en" },
                                turn_detection: {
                                    type: "server_vad",
                                    threshold: 0.5,
                                    prefix_padding_ms: 300,
                                    silence_duration_ms: 1200,
                                    create_response: true,
                                    interrupt_response: true,
                                },
                            },
                        },
                        tools: [{
                            type: "function",
                            name: "search_web",
                            description: "Search the web for up-to-date facts, especially regarding recent platform changes, metrics, or news you are uncertain about. Call this if you need current information.",
                            parameters: {
                                type: "object",
                                properties: { query: { type: "string", description: "The search query" } },
                                required: ["query"]
                            }
                        }]
                    }
                };
                dc.send(JSON.stringify(sessionUpdateEvent));

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
            // Ephemeral token flow (official GA docs):
            // POST SDP to /v1/realtime/calls with Bearer <ephemeral_key>
            // Model is already bound to the token from /client_secrets
            const sdpRes = await fetch("https://api.openai.com/v1/realtime/calls", {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${EPHEMERAL_KEY}`,
                    "Content-Type": "application/sdp"
                },
                body: offer.sdp
            });

            if (!sdpRes.ok) {
                const errText = await sdpRes.text();
                console.error(`WebRTC SDP exchange failed (${sdpRes.status}):`, errText);
                alert(`WebRTC connection failed (${sdpRes.status}). Check your network.`);
                setStatus("CONNECTION FAILED");
                isStartingRef.current = false;
                stopCapture();
                return;
            }

            const answerSdp = await sdpRes.text();
            await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

        } catch (e) {
            console.error("startRealtime error:", e);
            const errDetail = e.message || String(e);
            alert(`Start failed: ${errDetail}`);
            setStatus(`START FAILED: ${errDetail.substring(0, 50)}`);
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

    // Best-effort: tell the backend to END the interview session when the app
    // window is closed/quit or navigated away. Uses sendBeacon so the request
    // still goes out during teardown. This is a convenience — the server-side
    // stale-session sweep is the real guarantee — but it closes sessions
    // promptly so they aren't reused for free after a hard close.
    useEffect(() => {
        const endOnExit = () => {
            if (!isSessionActiveRef.current) return;
            try {
                navigator.sendBeacon(`${API_BASE_URL}/session/end`);
            } catch (_) { /* best effort */ }
        };
        window.addEventListener('pagehide', endOnExit);
        return () => window.removeEventListener('pagehide', endOnExit);
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

            // The interviewer just started speaking: if steering nudges are
            // queued, slip them into the conversation as a system item NOW —
            // before server VAD triggers the response — so they mix with this
            // question without touching its transcript.
            if (nudgesRef.current.length > 0 && window._lastDC && window._lastDC.readyState === "open") {
                try {
                    window._lastDC.send(JSON.stringify({
                        type: "conversation.item.create",
                        item: {
                            type: "message",
                            role: "system",
                            content: [{ type: "input_text", text: buildSteeringNote(nudgesRef.current) }]
                        }
                    }));
                    clearNudges();
                } catch (e) {
                    console.warn("Failed to send steering note:", e);
                }
            }
        }
        else if (type === "input_audio_buffer.speech_stopped") {
            setStatus("PROCESSING...");
            setIsListening(false);
            setIsProcessing(true);

            // CRITICAL FIX: Create card NOW before answer arrives
            typeQueueRef.current = [];
            isTypingRef.current = false;
            setQaList(prev => [...prev, {
                question: "Processing...",
                answer: "",
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            }]);
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
        else if (type === "response.text.delta" || type === "response.output_text.delta") {
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
        else if (type === "response.function_call_arguments.done") {
            if (event.name === "search_web") {
                handleAutoSearch(event.call_id, event.arguments);
            }
        }
        else if (type === "error") {
            // Surface realtime API rejections (e.g. a malformed response.create)
            // that would otherwise fail silently and look like "nothing happened".
            console.error("[Realtime error]", event.error || event);
        }
    };

    const handleAutoSearch = async (callId, argumentsString) => {
        try {
            const args = JSON.parse(argumentsString);
            const query = args.query;
            console.log("Auto search triggered by AI. Query:", query);

            setStatus("SEARCHING WEB...");

            // Fetch results from backend
            const res = await fetch(`${API_BASE_URL}/api/search`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: 'include',
                body: JSON.stringify({ query })
            });
            const data = await res.json();
            const searchContext = data.results || "No results found.";

            // Return the function output to the AI
            const toolEvent = {
                type: "conversation.item.create",
                item: {
                    type: "function_call_output",
                    call_id: callId,
                    output: searchContext
                }
            };
            window._lastDC.send(JSON.stringify(toolEvent));

            // Tell the AI to continue its response using the new facts
            window._lastDC.send(JSON.stringify({ type: "response.create" }));

        } catch (err) {
            console.error("Auto search failed:", err);
            setStatus("SEARCH FAILED");
            // If it fails, send an empty response so the model doesn't hang
            const toolEvent = {
                type: "conversation.item.create",
                item: {
                    type: "function_call_output",
                    call_id: callId,
                    output: "Search failed. Do your best to answer without recent facts."
                }
            };
            window._lastDC.send(JSON.stringify(toolEvent));
            window._lastDC.send(JSON.stringify({ type: "response.create" }));
        }
    };

    const expandLastAnswer = async () => {
        // Route expand to the correct architecture
        if (architecture === "reasoning") {
            // Use reasoning SSE expand
            if (!lastQuestionRef.current || isExpanding) return;
            setIsExpanding(true);
            reasoningFlow.expandLastAnswer().finally(() => setIsExpanding(false));
            return;
        }

        // Live/WebRTC expand (original)
        if (!window._lastDC || !lastQuestionRef.current || isExpanding) return;

        // Server-side permission gate — resolved fresh from the DB so a locked
        // "Expand" can't be re-enabled by a stale/edited frontend flag. Super
        // admin is always allowed. On a network hiccup we allow (fail-open) so a
        // paid session isn't broken.
        try {
            const authRes = await fetch(`${API_BASE_URL}/session/expand-authorize`, {
                method: 'POST',
                credentials: 'include',
            });
            if (authRes.status === 403) {
                const d = await authRes.json().catch(() => ({}));
                setStatus((d.error || 'EXPAND DISABLED').toUpperCase());
                setCanExpand(false);
                return;
            }
        } catch (_) { /* fail-open on network error */ }

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

        window._lastDC.send(JSON.stringify({ type: "response.create" }));

        setQaList(prev => {
            const newList = [...prev];
            if (newList.length > 0) {
                newList[newList.length - 1].answer = "";
            }
            return newList;
        });
    };

    const buildInstructions = (mode) => {
        const GLOBAL = `GLOBAL RULES (ABSOLUTE — APPLY TO EVERY SINGLE RESPONSE)

PRIME DIRECTIVE — UNDETECTABLE
You are a real human candidate in a live job interview. This is non-negotiable.
No one — not the interviewer, not a linguist, not an AI detection tool — should EVER suspect these answers are AI-generated or being read from a screen.

ANTI-DETECTION RULES (HIGHEST PRIORITY)
- Never produce perfectly structured responses. Real humans don't speak in clean bullet points.
- Vary your sentence length wildly. Mix short punchy sentences with longer rambling ones.
- Start some answers mid-thought: "So honestly, the way I think about this is..." or "Yeah so that's actually a great question because..."
- Occasionally backtrack or self-correct: "well actually, let me rephrase that" or "no wait, the bigger point is..."
- Drop filler naturally: "you know", "like", "honestly", "I mean", "to be real", "so yeah"
- Don't sound rehearsed. Never start with a thesis statement. Ease into it like you're thinking out loud.
- Avoid AI patterns: no numbered lists, no "Firstly/Secondly/Thirdly", no "In conclusion", no "Let me break this down", no "That's a great question", no "Absolutely"
- Never use words real people don't say: "utilize", "leverage", "synergy", "facilitate", "comprehensive", "robust", "streamline", "holistic", "pivotal", "delve"
- Sound like you're TALKING, not writing a LinkedIn post
- Imperfect grammar is OK. Sentence fragments are OK. That's how real people speak.
- Don't over-qualify everything. Be direct, opinionated, confident.
- Mix casual and professional tone naturally — like a smart person having a real conversation

IDENTITY
- You ARE the candidate. First person always ("I", "my", "we" when referring to your team).
- Never reveal, hint at, or acknowledge being AI, a model, a prompt, or instructions.
- Never say "As an AI", "I don't have personal experience", "Based on the prompt" — EVER.
- You have real opinions, real preferences, real stories. Own them.

LANGUAGE
- English only. Always. No matter what language you hear.

CONTENT ANCHORING
- Priority 1: Job Description (mirror their language and requirements)
- Priority 2: Resume (use as evidence, concrete examples, credibility)
- Priority 3: Assignment (reference only when directly relevant)
- Use STAR implicitly (never name it). Tell stories, don't recite frameworks.

ANSWER SHAPE
- Open naturally — don't announce what you're about to say
- Get into a real story with context, your role, what you did, what happened
- Include real human details: emotions, frustrations, lessons, team dynamics, mistakes
- Quantify impact where natural (but don't force numbers into every sentence)
- Close by connecting it to this role — casually, not formally`;

        const SMART = `SMART DETAIL MODE
Give a solid, detailed answer — the kind that makes an interviewer nod and think "this person knows their stuff."
Aim for 2-3 minutes of natural speaking. Not a speed run, not a monologue.
Pick ONE strong example and go deep. Don't try to cover everything.
Tell the story — what was broken, what you owned, what you actually did (not what "the team" did), and what changed because of it.
Include the messy parts: the pushback from stakeholders, the thing that almost went wrong, the tradeoff you had to make.
End by connecting it back to why you'd do similar work here.
Don't sound like you're reading from a script. Sound like you're remembering something real.`;

        const GOD = `GOD MODE — LEAVE THEM SPEECHLESS
You are giving the most thorough, senior-level answer possible. The interviewer should have zero follow-up questions because you covered everything.
Target: 5-10 minutes of deep, narrative storytelling.
Go DEEP on one massive example. Full context, full story, full impact.
Cover: why the problem mattered to the business, who was involved, the politics, what you actually built/decided/led, what went wrong, how you adapted, the measurable result, and what you'd do differently now.
If the question is short or vague — treat it as an invitation to tell your best story.
Technical depth is welcome but explain it like you're talking to a smart non-expert.
Show leadership maturity: talk about tradeoffs, stakeholder management, cross-functional collaboration.
Include real human moments: "I was honestly nervous about this", "looking back I would have...", "the part I'm most proud of is..."
End with a natural bridge to this role.
NEVER bullet-point your way through this. This is a story, not a report.`;

        const HR_LAYER = `HR-FOCUSED OVERLAY:
Warm, self-aware, thoughtful, emotionally intelligent answers that HR loves.
Focus on: teamwork, conflict resolution, ownership, leadership potential, work style, stakeholder management, communication, culture alignment, decision-making, learning from failures.
Explain WHY you chose certain actions — show self-reflection.
Use simple, clear language. Emphasize empathy, collaboration, overcoming challenges.
Show maturity, coachability, and humility. Still technical enough to impress.
Results must be quantifiable — impact on team, project success, timelines.`;

        const TECHNICAL_LAYER = `HIGHLY TECHNICAL OVERLAY:
Sharp, precise, analytical, systems-level thinking.
Deep-dive into architecture, design choices, frameworks, data pipelines.
Advanced tools (GA4, SQL, Python, APIs, infra, experimentation, ML basics).
Technical tradeoffs, scalability, reliability, latency, debugging.
Clear reasoning: WHY you made each decision.
Talk metrics, schemas, queries, events, tracking, systems.
Show complexity but keep clarity. Include "here's how I validated it" and "here's how I optimized it."
At least one quantifiable technical result (lift %, latency reduction, cost drop).`;

        const VP_LAYER = `VP-LEVEL OVERLAY:
Answer like a senior leader who sees across product, engineering, marketing, data, and business.
High executive presence, strategic clarity, top-down thinking.
Focus on: org-wide alignment, steering stakeholders, cross-functional leadership, business outcomes (revenue, cost, risk, customer experience), vision setting, roadmap shaping, prioritization frameworks.
Tradeoffs (short-term vs long-term), safeguarding execution quality, conflict navigation at leadership level.
Start with the business problem FIRST, then solution. Mention how you influence people at different levels.
No overly technical language unless needed — focus on impact. Always quantify business outcomes.`;

        const EXPAND = `EXPANSION MODE
You are expanding your previous answer into much more detail.
Go way deeper — minimum 5 minutes of storytelling.
Full context, full technical depth, full business impact with real metrics.
Answer as if it's a fresh question. Don't say "as I mentioned" or reference the previous answer.
This is your chance to really impress. Leave nothing on the table.`;

        let modeText;
        if (mode === "expand") {
            modeText = EXPAND;
        } else if (interviewMode === 'god') {
            modeText = GOD;
        } else if (interviewMode === 'hr') {
            modeText = SMART + "\n\n" + HR_LAYER;
        } else if (interviewMode === 'technical') {
            modeText = SMART + "\n\n" + TECHNICAL_LAYER;
        } else if (interviewMode === 'vp') {
            modeText = SMART + "\n\n" + VP_LAYER;
        } else {
            modeText = SMART;
        }

        const jdText = jd || "(No JD provided — give a strong general answer based on resume)";

        return [GLOBAL, modeText, "JOB DESCRIPTION (highest priority — mirror their language):", jdText].join("\n\n");
    };

    const sendSessionUpdate = (mode, instructionsOverride) => {
        if (!window._lastDC) return;
        const instructions = instructionsOverride || buildInstructions(mode);
        const event = {
            type: "session.update",
            // GA Realtime schema (nested under `type: "realtime"`) so mid-session
            // instruction swaps (mode change, JD save, expand) actually apply.
            session: { type: "realtime", instructions }
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

            // ROBUST CAPTURE: Use standard Video Element + Canvas (Works everywhere)
            const video = document.createElement('video');
            video.srcObject = screenStream;
            video.muted = true;
            await video.play();

            const canvas = document.createElement("canvas");
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(video, 0, 0);
            const base64 = canvas.toDataURL("image/jpeg", 0.7);

            // Cleanup
            track.stop();
            video.srcObject = null;

            setStatus("ANALYZING...");
            setInsightOpen(true);
            setInsightLoading(true);

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
                setInsightLoading(false);
                setInsightOpen(false);
                setStatus("LISTENING...");
                return;
            }
            if (data.analysis) {
                // Feed the model as before (hidden context that shapes the whisper)…
                if (window._lastDC) {
                    const event = {
                        type: "conversation.item.create",
                        item: {
                            type: "message",
                            role: "system",
                            content: [{ type: "input_text", text: `[SCREEN CONTEXT]: ${data.analysis}` }]
                        }
                    };
                    window._lastDC.send(JSON.stringify(event));
                }
                // …and surface it visually in the insight panel (previously discarded).
                setInsight({
                    keyPoints: data.key_points || '',
                    answerGuidance: data.answer_guidance || '',
                    analysis: data.analysis || '',
                    at: Date.now(),
                });
                setInsightLoading(false);
                setStatus("SCREEN ANALYZED");
                setTimeout(() => setStatus("LISTENING..."), 2000);
            } else {
                setInsightLoading(false);
                setInsightOpen(false);
            }
        } catch (e) {
            console.error(e);
            alert("Screen Analysis Error: " + e.message); // Show exact error to user
            setInsightLoading(false);
            setInsightOpen(false);
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
        } else {
            // Browser fallback so the slider still gives visual feedback
            document.documentElement.style.opacity = val;
        }
    };

    // Re-ask the same question for a fresh answer (Live/Turbo data channel)
    const handleRegenerate = (index, question) => {
        if (!window._lastDC || !question || question === 'Processing...') return;

        setQaList(prev => {
            const newList = [...prev];
            if (newList[index]) {
                newList[index] = { ...newList[index], answer: "" };
            }
            return newList;
        });
        typeQueueRef.current = [];
        isTypingRef.current = false;

        window._lastDC.send(JSON.stringify({
            type: "conversation.item.create",
            item: {
                type: "message",
                role: "user",
                content: [{ type: "input_text", text: `Answer this question again, differently: ${question}` }]
            }
        }));
        window._lastDC.send(JSON.stringify({ type: "response.create" }));
        setStatus("REGENERATING...");
    };

    // "Answer now": force the model to answer an operator nudge immediately,
    // as its own transcript turn, without waiting for the interviewer.
    const sendNudgeNow = useCallback((text) => {
        const prompt = (text || '').trim();
        if (!prompt || !isSessionActive) return;

        if (architecture === 'reasoning') {
            reasoningFlow.askDirect(prompt);
            return;
        }

        // Live / Turbo (WebRTC data channel)
        if (!window._lastDC || window._lastDC.readyState !== 'open') return;
        lastQuestionRef.current = prompt;
        setQaList(prev => [...prev, {
            question: prompt,
            answer: "",
            direct: true,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        }]);
        typeQueueRef.current = [];
        isTypingRef.current = false;

        window._lastDC.send(JSON.stringify({
            type: "conversation.item.create",
            item: { type: "message", role: "user", content: [{ type: "input_text", text: prompt }] }
        }));
        window._lastDC.send(JSON.stringify({ type: "response.create" }));
        setCanExpand(true);
        setStatus("GENERATING...");
    }, [isSessionActive, architecture, reasoningFlow]);

    const handleManualSearch = async (index, question) => {
        if (!question) return;
        try {
            setStatus("SEARCHING WEB...");

            const searchRes = await fetch(`${API_BASE_URL}/api/search`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ query: question })
            });

            const searchData = await searchRes.json();
            const webContext = searchData.results || '';

            if (!webContext || webContext === 'No recent or relevant search results found across all providers.') {
                setStatus("NO RESULTS FOUND");
                setTimeout(() => setStatus(isSessionActive ? "LISTENING..." : "SYSTEM READY"), 2000);
                return;
            }

            // If we have a data channel (Live mode), inject the web context
            if (window._lastDC) {
                const event = {
                    type: "conversation.item.create",
                    item: {
                        type: "message",
                        role: "system",
                        content: [{ type: "input_text", text: `[WEB SEARCH CONTEXT for "${question}"]: ${webContext}` }]
                    }
                };
                window._lastDC.send(JSON.stringify(event));

                // Clear the answer and regenerate
                setQaList(prev => {
                    const newList = [...prev];
                    if (newList[index]) {
                        newList[index] = { ...newList[index], answer: "" };
                    }
                    return newList;
                });

                typeQueueRef.current = [];
                isTypingRef.current = false;

                // Send response.create to regenerate
                const regenEvent = {
                    type: "conversation.item.create",
                    item: {
                        type: "message",
                        role: "user",
                        content: [{ type: "input_text", text: `Using the web search context provided, answer this question with the latest information: ${question}` }]
                    }
                };
                window._lastDC.send(JSON.stringify(regenEvent));
                window._lastDC.send(JSON.stringify({ type: "response.create" }));
            }

            setStatus("REGENERATING...");
        } catch (e) {
            console.error("Manual search error:", e);
            setStatus("SEARCH FAILED");
            setTimeout(() => setStatus(isSessionActive ? "LISTENING..." : "SYSTEM READY"), 2000);
        }
    };

    // Loading state
    if (isAppLoading) {
        return (
            <div className="app-container">
                <div className="void-bg">
                    <div className="aurora"></div>
                    <div className="noise"></div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'rgba(255,255,255,0.5)', fontFamily: 'var(--font-body)', fontSize: '14px', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                    Loading...
                </div>
            </div>
        );
    }

    // Role-based rendering: Admin Dashboard
    if (userRole === 'admin') {
        return <AdminDashboard />;
    }

    const isSuperAdmin = userRole === 'super_admin';
    const timerWarning = !unlimitedCredits && isSessionActive && remainingTime < 300;
    const timerLabel = unlimitedCredits
        ? formatClock(isSessionActive ? elapsedSeconds : 0)
        : formatClock(remainingTime);
    const creditsLabel = unlimitedCredits ? 'Unlimited' : `${credits} min`;

    const closePanel = () => setPanel(null);

    // The Whisperer tool: floating toolbar, transcript, dock, prefs, drawers.
    // Renders inside the console's whisperer pane (superadmin) or the full
    // window (user role).
    const whispererView = (
        <div className="whisper-view">
            {/* Floating toolbar, top-left */}
            <div className="whisper-toolbar">
                <button
                    className={`toolbar-btn ${panel === 'history' ? 'active' : ''}`}
                    onClick={() => setPanel(panel === 'history' ? null : 'history')}
                >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10"></circle>
                        <polyline points="12 6 12 12 16 14"></polyline>
                    </svg>
                    History
                </button>
                <button
                    className={`toolbar-btn ${panel === 'jd' ? 'active' : ''}`}
                    onClick={() => setPanel(panel === 'jd' ? null : 'jd')}
                >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                        <polyline points="14 2 14 8 20 8"></polyline>
                    </svg>
                    Job description
                </button>
                {insight && (
                    <button
                        className={`toolbar-btn ${insightOpen ? 'active' : ''}`}
                        onClick={() => setInsightOpen((o) => !o)}
                        title="Screen insight"
                    >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M9 18h6"></path>
                            <path d="M10 22h4"></path>
                            <path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14"></path>
                        </svg>
                        Insight
                    </button>
                )}
                {isSuperAdmin && (
                    <button
                        className={`toolbar-btn icon-only ${camOverlayOn ? 'active' : ''}`}
                        onClick={() => setCamOverlayOn(!camOverlayOn)}
                        title="Camera overlay"
                    >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M23 7l-7 5 7 5V7z"></path>
                            <rect x="1" y="5" width="15" height="14" rx="2"></rect>
                        </svg>
                    </button>
                )}
            </div>

            {/* Transcript / empty state */}
            <div className="whisper-stage">
                <QAList
                    qaList={qaList}
                    onManualSearch={handleManualSearch}
                    onRegenerate={architecture !== 'reasoning' ? handleRegenerate : null}
                    isProcessing={isProcessing}
                    steerBar={isSessionActive ? (
                        <SteerBar
                            nudges={nudges}
                            suggestions={steerSuggestions}
                            onToggle={toggleNudge}
                            onClear={clearNudges}
                            onSendNow={sendNudgeNow}
                        />
                    ) : null}
                />
            </div>

            {/* Drawer scrim + drawers */}
            {panel && <div className="iw-drawer-scrim" onClick={closePanel} />}
            <HistoryDrawer
                isOpen={panel === 'history'}
                onClose={closePanel}
                history={history}
                onSelect={loadHistoryItem}
                onDelete={deleteHistoryItem}
                onNewInterview={handleNewInterview}
            />
            <JobDescription
                isOpen={panel === 'jd'}
                onClose={closePanel}
                jd={jd}
                setJd={setJd}
                onSave={handleSaveJd}
            />

            {/* Candidate camera overlay tile (superadmin) */}
            {isSuperAdmin && camOverlayOn && (
                <CameraOverlayTile camera={camera} onClose={() => setCamOverlayOn(false)} />
            )}

            <CommandDock
                onStart={startSessionRouter}
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
                isRecording={isRecording}
                onToggleRecording={toggleRecording}
            />

            {/* Screen-analysis insight, docked in the right gutter */}
            {insightOpen && (
                <ScreenInsight
                    insight={insight}
                    loading={insightLoading}
                    onClose={() => setInsightOpen(false)}
                />
            )}

            {/* Preferences: round floating button, popover opens upward */}
            <button
                className={`prefs-btn ${isSettingsOpen ? 'active' : ''}`}
                onClick={() => setIsSettingsOpen(!isSettingsOpen)}
                title="Preferences"
            >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
                architecture={architecture}
                setArchitecture={setArchitecture}
                permissions={permissions}
                lockedFeatures={lockedFeatures}
                opacity={opacity}
                setOpacity={handleOpacityChange}
            />

            {/* User Help Button for Remote Control */}
            {userRole === 'user' && (
                <UserHelpButton
                    connected={socket.connected}
                    passcode={socket.passcode}
                    consentRequest={socket.consentRequest}
                    remoteSession={socket.remoteSession}
                    webrtcState={socket.webrtcState}
                    startWebRTC={socket.startWebRTC}
                    returnAudioStream={socket.returnAudioStream}
                    requestHelp={socket.requestHelp}
                    refreshPasscode={socket.refreshPasscode}
                    respondConsent={socket.respondConsent}
                    sendScreenFrame={socket.sendScreenFrame}
                    endSession={socket.endSession}
                />
            )}
        </div>
    );

    if (isSuperAdmin) {
        return (
            <SuperAdminWorkspace
                interviewContent={whispererView}
                camera={camera}
                status={status}
                isListening={isListening}
                isProcessing={isProcessing}
                isSessionActive={isSessionActive}
                timerLabel={timerLabel}
                timerWarning={timerWarning}
                creditsLabel={creditsLabel}
                onViewChange={() => { setPanel(null); setIsSettingsOpen(false); }}
                onLogout={handleLogout}
            />
        );
    }

    // User role: single-view console with the same floating chrome
    return (
        <div className="solo-console">
            <header className="solo-chrome">
                {view === 'profile' && (
                    <button className="profile-back" onClick={() => setView('console')} title="Back to console">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="19" y1="12" x2="5" y2="12"></line>
                            <polyline points="12 19 5 12 12 5"></polyline>
                        </svg>
                        Back to console
                    </button>
                )}
                <div className="solo-pill-slot">
                    <StatusPill
                        status={status}
                        isListening={isListening}
                        isProcessing={isProcessing}
                        isSessionActive={isSessionActive}
                        timerLabel={timerLabel}
                        timerWarning={timerWarning}
                        creditsLabel={creditsLabel}
                    />
                </div>
                {orgCode && (
                    <span
                        title="Your organization code (needed to sign in)"
                        style={{ fontSize: '11px', letterSpacing: '0.08em', color: 'var(--text-faint)', marginRight: '10px', fontFamily: 'var(--font-body)', whiteSpace: 'nowrap' }}
                    >
                        ORG {orgCode}
                    </span>
                )}
                <button
                    className={'profile-avatar' + (view === 'profile' ? ' active' : '')}
                    onClick={openProfile}
                    title="Profile"
                >
                    {(username || '?').slice(0, 2).toUpperCase()}
                </button>
                <button className="solo-signout" onClick={handleLogout} title="Sign out">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                        <polyline points="16 17 21 12 16 7"></polyline>
                        <line x1="21" y1="12" x2="9" y2="12"></line>
                    </svg>
                </button>
            </header>

            <div className={'solo-console-view' + (view === 'profile' ? ' dimmed' : '')}>
                {whispererView}
            </div>

            {profileMounted && (
                <div className={'solo-profile-view' + (view === 'profile' ? ' open' : '')}>
                    <ProfilePage
                        accent={accent}
                        theme={theme}
                        onAccentChange={applyAccent}
                        onThemeChange={applyTheme}
                        onSignOut={handleLogout}
                        orgCode={orgCode}
                        showToast={showProfileToast}
                    />
                </div>
            )}

            {profileToast && <div className="profile-toast">{profileToast}</div>}
        </div>
    );
}

export default function App() {
    const candidateMatch = window.location.pathname.match(/^\/camera\/([a-zA-Z0-9_-]{32,128})\/?$/);
    if (candidateMatch) return <CandidateCameraPage token={candidateMatch[1]} />;
    return <InterviewApp />;
}
