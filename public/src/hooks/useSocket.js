/**
 * useSocket — React hook for Socket.IO connection
 * Shares a single connection per session, auto-reconnects
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
            setRemoteSession({ sessionKey, controlled, userId, username });
            setWaitingConsent(null);
            setPasscode(null);
        });

        // Consent denied
        socket.on('rc:consent-denied', ({ username }) => {
            setError(`${username} denied the connection request`);
            setWaitingConsent(null);
        });

        // Screen frame (admin-side)
        socket.on('rc:screen-frame', ({ frame }) => {
            setScreenFrame(frame);
        });

        // Session ended
        socket.on('rc:session-ended', ({ reason }) => {
            console.log('[Socket] Session ended:', reason);
            setRemoteSession(null);
            setScreenFrame(null);
        });

        // Error
        socket.on('rc:error', ({ message }) => {
            setError(message);
            setTimeout(() => setError(null), 4000);
        });

        return () => {
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
        setRemoteSession(null);
        setScreenFrame(null);
    }, [remoteSession]);

    return {
        connected,
        onlineUsers,
        passcode,
        remoteSession,
        consentRequest,
        screenFrame,
        error,
        waitingConsent,
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
