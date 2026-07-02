/**
 * UserHelpButton — User-side remote control UI
 * Floating help button + passcode + consent dialog + auto screen capture
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import useScreenCapture from '../hooks/useScreenCapture';
import './UserHelpButton.css';

// If WebRTC hasn't connected within this window, fall back to MJPEG.
const WEBRTC_CONNECT_TIMEOUT = 8000;

export default function UserHelpButton({
    connected, passcode, consentRequest, remoteSession,
    webrtcState, startWebRTC,
    requestHelp, refreshPasscode, respondConsent, sendScreenFrame, endSession
}) {
    const [expanded, setExpanded] = useState(false);

    // Latest WebRTC state, readable from timers without re-subscribing
    const webrtcStateRef = useRef(webrtcState);
    webrtcStateRef.current = webrtcState;
    const fallbackTimerRef = useRef(null);
    const fallbackFnRef = useRef(null);

    // MJPEG fallback frame → socket
    const onFrame = useCallback((frame) => {
        sendScreenFrame(frame);
    }, [sendScreenFrame]);

    // Primary path: hand the raw stream to WebRTC, then arm a fallback watchdog
    const onStream = useCallback((stream) => {
        startWebRTC(stream);
        clearTimeout(fallbackTimerRef.current);
        fallbackTimerRef.current = setTimeout(() => {
            const s = webrtcStateRef.current;
            if (s !== 'connected' && s !== 'completed') {
                console.warn('[RemoteControl] WebRTC did not connect in time — starting MJPEG fallback');
                fallbackFnRef.current?.();
            }
        }, WEBRTC_CONNECT_TIMEOUT);
    }, [startWebRTC]);

    const { isCapturing, startCapture, startMjpegFallback, stopCapture } = useScreenCapture({
        onFrame,
        onStream,
    });
    fallbackFnRef.current = startMjpegFallback;

    // Auto-start screen capture when remote session begins
    useEffect(() => {
        if (remoteSession?.controlled && !isCapturing) {
            // On macOS this triggers the one-time Accessibility permission prompt
            // so the admin's clicks/keystrokes can actually control this machine.
            window.electron?.ensureInputPermission?.();
            startCapture();
        }
        if (!remoteSession?.controlled && isCapturing) {
            clearTimeout(fallbackTimerRef.current);
            stopCapture();
        }
    }, [remoteSession?.controlled, isCapturing, startCapture, stopCapture]);

    // If WebRTC connection outright fails, switch to MJPEG immediately
    useEffect(() => {
        if (!isCapturing) return;
        if (webrtcState === 'connected' || webrtcState === 'completed') {
            clearTimeout(fallbackTimerRef.current);
        } else if (webrtcState === 'failed') {
            startMjpegFallback();
        }
    }, [webrtcState, isCapturing, startMjpegFallback]);

    // Stop capture on unmount
    useEffect(() => {
        return () => {
            clearTimeout(fallbackTimerRef.current);
            stopCapture();
        };
    }, [stopCapture]);

    const handleEndSession = () => {
        clearTimeout(fallbackTimerRef.current);
        stopCapture();
        endSession();
    };

    const streaming = webrtcState === 'connected' || webrtcState === 'completed' || isCapturing;

    // Consent dialog overlay
    if (consentRequest) {
        return (
            <div className="uh-overlay">
                <div className="uh-consent-card">
                    <div className="uh-consent-icon">🔒</div>
                    <h3>Remote Access Request</h3>
                    <p><strong>{consentRequest.adminName}</strong> wants to view your screen and assist you.</p>
                    <p className="uh-consent-note">You can end the session at any time.</p>
                    <div className="uh-consent-actions">
                        <button className="uh-btn uh-btn-accept" onClick={() => respondConsent(true)}>
                            Allow Access
                        </button>
                        <button className="uh-btn uh-btn-deny" onClick={() => respondConsent(false)}>
                            Deny
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // Active session indicator
    if (remoteSession?.controlled) {
        return (
            <div className="uh-active-bar">
                <span className="uh-active-dot"></span>
                <span>Admin is viewing your screen {streaming ? '(streaming)' : '(starting...)'}</span>
                <button className="uh-btn uh-btn-end" onClick={handleEndSession}>End</button>
            </div>
        );
    }

    // Passcode display
    if (passcode && expanded) {
        return (
            <div className="uh-panel">
                <div className="uh-panel-header">
                    <span>Your Help Code</span>
                    <button className="uh-close" onClick={() => setExpanded(false)}>×</button>
                </div>
                <div className="uh-passcode">{passcode.code}</div>
                <p className="uh-passcode-hint">Share this code with your admin</p>
                <button className="uh-btn uh-btn-secondary" onClick={refreshPasscode}>
                    Refresh Code
                </button>
            </div>
        );
    }

    // Default: floating help button
    return (
        <button
            className={`uh-fab ${connected ? '' : 'uh-disabled'}`}
            onClick={() => {
                if (!passcode) requestHelp();
                setExpanded(true);
            }}
            title={connected ? 'Request help' : 'Not connected'}
            disabled={!connected}
        >
            <span className="uh-fab-icon">🆘</span>
        </button>
    );
}
