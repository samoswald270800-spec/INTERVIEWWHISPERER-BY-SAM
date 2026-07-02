/**
 * useSocket — React hook for Socket.IO connection + WebRTC remote control
 *
 * Screen sharing runs over WebRTC (peer-to-peer video, hardware-accelerated,
 * 30-60 FPS). Socket.IO carries only the signaling handshake (SDP + ICE) and
 * input events. A legacy MJPEG-over-socket path remains as an automatic
 * fallback for networks where a P2P connection can't be established.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';
import API_BASE_URL from '../config';

export default function useSocket(enabled = true) {
    const socketRef = useRef(null);
    const [connected, setConnected] = useState(false);
    const [onlineUsers, setOnlineUsers] = useState([]);
    const [passcode, setPasscode] = useState(null);
    const [remoteSession, setRemoteSession] = useState(null);
    const [consentRequest, setConsentRequest] = useState(null);
    const [screenFrame, setScreenFrame] = useState(null);
    const [error, setError] = useState(null);
    const [waitingConsent, setWaitingConsent] = useState(null);

    // ── WebRTC state ──
    const [remoteStream, setRemoteStream] = useState(null);   // admin-side: incoming video
    const [webrtcState, setWebrtcState] = useState('new');    // RTCPeerConnection.connectionState
    const pcRef = useRef(null);
    const pendingCandidatesRef = useRef([]);
    const iceServersRef = useRef(null);
    const sessionKeyRef = useRef(null);

    // Keep the current session key in a ref for signaling closures
    useEffect(() => {
        if (remoteSession?.sessionKey) sessionKeyRef.current = remoteSession.sessionKey;
    }, [remoteSession]);

    // Fetch (and cache) the ICE server list from the server
    const getIceServers = useCallback(async () => {
        if (iceServersRef.current) return iceServersRef.current;
        try {
            const res = await fetch(`${API_BASE_URL}/api/webrtc/ice-config`, { credentials: 'include' });
            const json = await res.json();
            iceServersRef.current = (json && json.iceServers) || [{ urls: 'stun:stun.l.google.com:19302' }];
        } catch (e) {
            console.warn('[WebRTC] ICE config fetch failed, using default STUN:', e.message);
            iceServersRef.current = [{ urls: 'stun:stun.l.google.com:19302' }];
        }
        return iceServersRef.current;
    }, []);

    const emitSignal = useCallback((data) => {
        const sk = sessionKeyRef.current;
        if (!sk || !socketRef.current) return;
        socketRef.current.emit('rc:webrtc-signal', { sessionKey: sk, data });
    }, []);

    const closeWebRTC = useCallback(() => {
        if (pcRef.current) {
            try { pcRef.current.close(); } catch { /* noop */ }
            pcRef.current = null;
        }
        pendingCandidatesRef.current = [];
        setRemoteStream(null);
        setWebrtcState('new');
    }, []);

    const createPeer = useCallback(async () => {
        const iceServers = await getIceServers();
        const pc = new RTCPeerConnection({ iceServers, bundlePolicy: 'max-bundle' });

        pc.onicecandidate = (e) => {
            if (e.candidate) emitSignal({ type: 'ice', candidate: e.candidate });
        };
        pc.ontrack = (e) => {
            if (e.streams && e.streams[0]) setRemoteStream(e.streams[0]);
        };
        pc.onconnectionstatechange = () => {
            setWebrtcState(pc.connectionState);
            if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
                // Drop the (dead) stream so the viewer can fall back to MJPEG
                setRemoteStream(null);
            }
        };

        pcRef.current = pc;
        return pc;
    }, [getIceServers, emitSignal]);

    const drainCandidates = useCallback(async () => {
        const pc = pcRef.current;
        if (!pc) return;
        while (pendingCandidatesRef.current.length) {
            const c = pendingCandidatesRef.current.shift();
            try { await pc.addIceCandidate(new RTCIceCandidate(c)); }
            catch (e) { console.warn('[WebRTC] addIceCandidate failed:', e.message); }
        }
    }, []);

    // Host (user/controlled side): start sending the screen stream
    const startWebRTC = useCallback(async (stream) => {
        try {
            closeWebRTC();
            const pc = await createPeer();
            stream.getTracks().forEach((t) => pc.addTrack(t, stream));
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            emitSignal({ type: 'offer', sdp: pc.localDescription });
        } catch (e) {
            console.error('[WebRTC] host start failed:', e);
            setWebrtcState('failed');
        }
    }, [closeWebRTC, createPeer, emitSignal]);

    // Handle an inbound signal (both roles)
    const handleSignal = useCallback(async (data) => {
        try {
            if (data.type === 'offer') {
                // Receiver (admin): answer the offer
                const pc = pcRef.current || await createPeer();
                await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
                await drainCandidates();
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                emitSignal({ type: 'answer', sdp: pc.localDescription });
            } else if (data.type === 'answer') {
                // Host (user): accept the answer
                if (pcRef.current) {
                    await pcRef.current.setRemoteDescription(new RTCSessionDescription(data.sdp));
                    await drainCandidates();
                }
            } else if (data.type === 'ice') {
                if (pcRef.current && pcRef.current.remoteDescription) {
                    try { await pcRef.current.addIceCandidate(new RTCIceCandidate(data.candidate)); }
                    catch (e) { console.warn('[WebRTC] addIceCandidate failed:', e.message); }
                } else {
                    // Queue until remote description is set
                    pendingCandidatesRef.current.push(data.candidate);
                }
            }
        } catch (e) {
            console.error('[WebRTC] signal error:', e);
        }
    }, [createPeer, drainCandidates, emitSignal]);

    // Refs so the socket effect can call the latest handlers without re-subscribing
    const handleSignalRef = useRef(handleSignal);
    handleSignalRef.current = handleSignal;
    const closeWebRTCRef = useRef(closeWebRTC);
    closeWebRTCRef.current = closeWebRTC;

    useEffect(() => {
        if (!enabled) return;

        const socket = io(API_BASE_URL || window.location.origin, {
            withCredentials: true,
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionDelay: 2000,
            reconnectionAttempts: 10,
        });

        socketRef.current = socket;

        socket.on('connect', () => {
            console.log('[Socket] Connected:', socket.id);
            setConnected(true);
            setError(null);
        });

        socket.on('disconnect', (reason) => {
            console.log('[Socket] Disconnected:', reason);
            setConnected(false);
        });

        // Online users list (admin-side)
        socket.on('rc:online-users', (users) => {
            setOnlineUsers(users);
        });

        // Passcode received (user-side)
        socket.on('rc:passcode', ({ code, expiresAt }) => {
            setPasscode({ code, expiresAt });
        });

        // Help request notification (admin-side)
        socket.on('rc:help-request', ({ userId, username }) => {
            console.log(`[Socket] Help request from ${username}`);
            // Could trigger a toast/notification
        });

        // Consent request (user-side)
        socket.on('rc:consent-request', ({ adminSocketId, adminName }) => {
            setConsentRequest({ adminSocketId, adminName });
        });

        // Waiting for consent (admin-side)
        socket.on('rc:waiting-consent', ({ username }) => {
            setWaitingConsent(username);
        });

        // Connected to remote session
        socket.on('rc:connected', ({ sessionKey, controlled, userId, username }) => {
            sessionKeyRef.current = sessionKey;
            closeWebRTCRef.current();  // reset any stale peer connection
            setRemoteSession({ sessionKey, controlled, userId, username });
            setWaitingConsent(null);
            setPasscode(null);
        });

        // Consent denied
        socket.on('rc:consent-denied', ({ username }) => {
            setError(`${username} denied the connection request`);
            setWaitingConsent(null);
        });

        // WebRTC signaling (offer / answer / ICE)
        socket.on('rc:webrtc-signal', ({ sessionKey, data }) => {
            if (sessionKey) sessionKeyRef.current = sessionKey;
            handleSignalRef.current(data);
        });

        // Screen frame (admin-side) — MJPEG fallback path only
        socket.on('rc:screen-frame', ({ frame }) => {
            setScreenFrame(frame);
        });

        // Input event from admin → forward to Electron for native simulation
        socket.on('rc:input-event', ({ event }) => {
            if (window.electron?.simulateInput) {
                window.electron.simulateInput(event);
            }
        });

        // Session ended
        socket.on('rc:session-ended', ({ reason }) => {
            console.log('[Socket] Session ended:', reason);
            closeWebRTCRef.current();
            setRemoteSession(null);
            setScreenFrame(null);
        });

        // Error
        socket.on('rc:error', ({ message }) => {
            setError(message);
            setTimeout(() => setError(null), 4000);
        });

        return () => {
            closeWebRTCRef.current();
            socket.disconnect();
            socketRef.current = null;
        };
    }, [enabled]);

    // ── User Actions ──
    const requestHelp = useCallback(() => {
        socketRef.current?.emit('rc:request-help');
    }, []);

    const refreshPasscode = useCallback(() => {
        socketRef.current?.emit('rc:refresh-passcode');
    }, []);

    const respondConsent = useCallback((accepted) => {
        if (!consentRequest) return;
        socketRef.current?.emit('rc:consent-response', {
            accepted,
            adminSocketId: consentRequest.adminSocketId,
        });
        setConsentRequest(null);
    }, [consentRequest]);

    const sendScreenFrame = useCallback((frame) => {
        if (!remoteSession) return;
        socketRef.current?.emit('rc:screen-frame', {
            sessionKey: remoteSession.sessionKey,
            frame,
        });
    }, [remoteSession]);

    // ── Admin Actions ──
    const connectWithPasscode = useCallback((code) => {
        socketRef.current?.emit('rc:connect-passcode', { code });
    }, []);

    const sendInputEvent = useCallback((event) => {
        if (!remoteSession) return;
        socketRef.current?.emit('rc:input-event', {
            sessionKey: remoteSession.sessionKey,
            event,
        });
    }, [remoteSession]);

    // ── Shared ──
    const endSession = useCallback(() => {
        if (!remoteSession) return;
        socketRef.current?.emit('rc:end-session', {
            sessionKey: remoteSession.sessionKey,
        });
        closeWebRTC();
        setRemoteSession(null);
        setScreenFrame(null);
    }, [remoteSession, closeWebRTC]);

    return {
        connected,
        onlineUsers,
        passcode,
        remoteSession,
        consentRequest,
        screenFrame,
        error,
        waitingConsent,
        // WebRTC
        remoteStream,
        webrtcState,
        startWebRTC,
        // User actions
        requestHelp,
        refreshPasscode,
        respondConsent,
        sendScreenFrame,
        // Admin actions
        connectWithPasscode,
        sendInputEvent,
        // Shared
        endSession,
    };
}
