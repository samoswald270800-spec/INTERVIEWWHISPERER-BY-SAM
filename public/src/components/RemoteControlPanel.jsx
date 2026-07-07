/**
 * RemoteControlPanel — Zoom-quality remote control viewer
 * Canvas-based screen viewer with cursor overlay, throttled input, fullscreen
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import './RemoteControlPanel.css';

// Throttle helper
function throttle(fn, ms) {
    let last = 0;
    return (...args) => {
        const now = Date.now();
        if (now - last >= ms) { last = now; fn(...args); }
    };
}

export default function RemoteControlPanel({
    connected, onlineUsers, error, waitingConsent,
    remoteSession, screenFrame, remoteStream,
    connectWithPasscode, sendInputEvent, endSession
}) {
    const [passcodeInput, setPasscodeInput] = useState('');
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [fps, setFps] = useState(0);
    const canvasRef = useRef(null);
    const videoRef = useRef(null);
    const containerRef = useRef(null);
    const imgBufferRef = useRef(new Image());
    const frameCountRef = useRef(0);
    const fpsIntervalRef = useRef(null);
    const cursorPosRef = useRef({ x: 0.5, y: 0.5 });
    const surfaceRef = useRef(null);

    // Prefer the live WebRTC video stream; fall back to MJPEG frames.
    const usingVideo = !!remoteStream;

    // FPS counter
    useEffect(() => {
        if (remoteSession) {
            fpsIntervalRef.current = setInterval(() => {
                setFps(frameCountRef.current);
                frameCountRef.current = 0;
            }, 1000);
            return () => clearInterval(fpsIntervalRef.current);
        }
    }, [remoteSession]);

    // Grab keyboard focus when a session becomes active so keystrokes are captured
    useEffect(() => {
        if (!remoteSession) return;
        const t = setTimeout(() => surfaceRef.current?.focus({ preventScroll: true }), 150);
        return () => clearTimeout(t);
    }, [remoteSession]);

    // Attach the WebRTC stream to the <video> element and count real frames
    useEffect(() => {
        const video = videoRef.current;
        if (!video || !remoteStream) return;

        video.srcObject = remoteStream;
        video.play().catch(() => {});

        // Count decoded frames for the FPS readout when supported
        let rafHandle = null;
        if (typeof video.requestVideoFrameCallback === 'function') {
            const onFrameCb = () => {
                frameCountRef.current++;
                rafHandle = video.requestVideoFrameCallback(onFrameCb);
            };
            rafHandle = video.requestVideoFrameCallback(onFrameCb);
        }

        return () => {
            if (rafHandle && typeof video.cancelVideoFrameCallback === 'function') {
                video.cancelVideoFrameCallback(rafHandle);
            }
        };
    }, [remoteStream]);

    // Draw MJPEG fallback frame to canvas (double-buffered via Image preload)
    useEffect(() => {
        if (usingVideo || !screenFrame || !canvasRef.current) return;

        const img = imgBufferRef.current;
        img.onload = () => {
            const canvas = canvasRef.current;
            if (!canvas) return;

            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;

            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);

            // Draw admin cursor overlay
            const cx = cursorPosRef.current.x * canvas.width;
            const cy = cursorPosRef.current.y * canvas.height;
            drawCursor(ctx, cx, cy);

            frameCountRef.current++;
        };
        img.src = screenFrame;
    }, [screenFrame, usingVideo]);

    // Draw a clean cursor
    const drawCursor = (ctx, x, y) => {
        ctx.save();
        ctx.translate(x, y);

        // White arrow with black outline
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(0, 20);
        ctx.lineTo(5.5, 15);
        ctx.lineTo(10, 24);
        ctx.lineTo(13, 22.5);
        ctx.lineTo(8.5, 14);
        ctx.lineTo(14, 13);
        ctx.closePath();

        ctx.strokeStyle = 'rgba(0,0,0,0.7)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        ctx.fill();

        // Small dot at tip for precision
        ctx.beginPath();
        ctx.arc(0, 0, 2, 0, Math.PI * 2);
        ctx.fillStyle = '#5E5CE6';
        ctx.fill();

        ctx.restore();
    };

    // Calculate relative coordinates on the active surface (video or canvas).
    // The video uses object-fit: contain, so the picture is letterboxed inside
    // the element — map the pointer to the actual picture area, not the element,
    // or clicks land offset from where the real cursor is.
    const getRelativeCoords = useCallback((e) => {
        const el = e.currentTarget;
        if (!el) return null;
        const rect = el.getBoundingClientRect();

        let contentW = rect.width, contentH = rect.height, offsetX = 0, offsetY = 0;
        const vw = el.videoWidth, vh = el.videoHeight; // set for <video>, undefined for <canvas>
        if (vw && vh && rect.width && rect.height) {
            const elAspect = rect.width / rect.height;
            const vidAspect = vw / vh;
            if (vidAspect > elAspect) {
                // Picture is wider than the box → bars on top/bottom
                contentW = rect.width;
                contentH = rect.width / vidAspect;
                offsetY = (rect.height - contentH) / 2;
            } else {
                // Picture is taller than the box → bars on left/right
                contentH = rect.height;
                contentW = rect.height * vidAspect;
                offsetX = (rect.width - contentW) / 2;
            }
        }

        const x = (e.clientX - rect.left - offsetX) / contentW;
        const y = (e.clientY - rect.top - offsetY) / contentH;
        return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
    }, []);

    // Throttled mousemove — moves cursor on user's machine in real-time (Zoom-style)
    const throttledMouseMove = useCallback(
        throttle((e) => {
            const coords = getRelativeCoords(e);
            if (!coords) return;
            cursorPosRef.current = coords;
            sendInputEvent({ type: 'mousemove', ...coords });
        }, 16), // 60 events/sec — buttery smooth cursor
        [getRelativeCoords, sendInputEvent]
    );

    const handleMouseEvent = useCallback((e, type) => {
        e.preventDefault();
        // Grab keyboard focus so typing/shortcuts reach the remote machine.
        surfaceRef.current?.focus({ preventScroll: true });
        const coords = getRelativeCoords(e);
        if (!coords) return;
        cursorPosRef.current = coords;
        sendInputEvent({ type, ...coords, button: e.button });
    }, [getRelativeCoords, sendInputEvent]);

    const handleKeyEvent = useCallback((e, type) => {
        e.preventDefault();
        e.stopPropagation();
        sendInputEvent({
            type,
            key: e.key,
            code: e.code,
            ctrlKey: e.ctrlKey,
            shiftKey: e.shiftKey,
            altKey: e.altKey,
            metaKey: e.metaKey,
        });
    }, [sendInputEvent]);

    const toggleFullscreen = useCallback(() => {
        if (!containerRef.current) return;
        if (!document.fullscreenElement) {
            containerRef.current.requestFullscreen().then(() => setIsFullscreen(true));
        } else {
            document.exitFullscreen().then(() => setIsFullscreen(false));
        }
    }, []);

    const handleConnect = (e) => {
        e.preventDefault();
        if (passcodeInput.length === 6) {
            connectWithPasscode(passcodeInput);
            setPasscodeInput('');
        }
    };

    // ═══════════════════════════════════════
    //  ACTIVE SESSION — Canvas Viewer
    // ═══════════════════════════════════════
    if (remoteSession) {
        return (
            <div className={`rc-panel rc-session-active ${isFullscreen ? 'rc-fullscreen' : ''}`} ref={containerRef}>
                <div className="rc-session-toolbar">
                    <div className="rc-status live">
                        <span className="rc-dot"></span>
                        <span className="rc-live-label">LIVE</span>
                        <span className="rc-session-user">{remoteSession.username || 'User'}</span>
                    </div>
                    <div className="rc-toolbar-right">
                        <span className="rc-fps">{usingVideo ? 'HD' : 'SD'} · {fps} FPS</span>
                        <button className="rc-toolbar-btn" onClick={toggleFullscreen} title="Fullscreen">
                            {isFullscreen ? '⊡' : '⊞'}
                        </button>
                        <button className="rc-toolbar-btn rc-toolbar-end" onClick={endSession}>
                            End Session
                        </button>
                    </div>
                </div>
                <div
                    className="rc-canvas-container"
                    ref={surfaceRef}
                    tabIndex={0}
                    onKeyDown={(e) => handleKeyEvent(e, 'keydown')}
                    onKeyUp={(e) => handleKeyEvent(e, 'keyup')}
                >
                    {usingVideo ? (
                        <video
                            ref={videoRef}
                            className="rc-canvas rc-video"
                            autoPlay
                            playsInline
                            muted
                            onClick={(e) => handleMouseEvent(e, 'click')}
                            onMouseMove={throttledMouseMove}
                            onMouseDown={(e) => handleMouseEvent(e, 'mousedown')}
                            onMouseUp={(e) => handleMouseEvent(e, 'mouseup')}
                            onDoubleClick={(e) => handleMouseEvent(e, 'dblclick')}
                            onContextMenu={(e) => { e.preventDefault(); handleMouseEvent(e, 'contextmenu'); }}
                            onWheel={(e) => { e.preventDefault(); sendInputEvent({ type: 'scroll', deltaY: e.deltaY }); }}
                        />
                    ) : screenFrame ? (
                        <canvas
                            ref={canvasRef}
                            className="rc-canvas"
                            onClick={(e) => handleMouseEvent(e, 'click')}
                            onMouseMove={throttledMouseMove}
                            onMouseDown={(e) => handleMouseEvent(e, 'mousedown')}
                            onMouseUp={(e) => handleMouseEvent(e, 'mouseup')}
                            onDoubleClick={(e) => handleMouseEvent(e, 'dblclick')}
                            onContextMenu={(e) => { e.preventDefault(); handleMouseEvent(e, 'contextmenu'); }}
                            onWheel={(e) => { e.preventDefault(); sendInputEvent({ type: 'scroll', deltaY: e.deltaY }); }}
                        />
                    ) : (
                        <div className="rc-screen-placeholder">
                            <div className="rc-spinner"></div>
                            <p>Connecting to user's screen...</p>
                            <p className="rc-sub">Negotiating peer-to-peer video…</p>
                        </div>
                    )}
                </div>
                <div className="rc-controls-hint">
                    <span>🖱️ Click &amp; drag to interact</span>
                    <span>⌨️ Type when viewer is focused</span>
                    <span>📺 {isFullscreen ? 'ESC to exit' : 'Click ⊞ for fullscreen'}</span>
                </div>
            </div>
        );
    }

    // ═══════════════════════════════════════
    //  WAITING FOR CONSENT
    // ═══════════════════════════════════════
    if (waitingConsent) {
        return (
            <div className="rc-panel">
                <div className="rc-waiting">
                    <div className="rc-spinner"></div>
                    <h3>Requesting access</h3>
                    <p>Waiting for <strong>{waitingConsent}</strong> to accept...</p>
                    <p className="rc-sub">The user will see a consent dialog</p>
                </div>
            </div>
        );
    }

    // ═══════════════════════════════════════
    //  DEFAULT — Connect Form + Online Users
    // ═══════════════════════════════════════
    return (
        <div className="rc-panel">
            <div className="rc-header">
                <h3 className="rc-title">Remote Control</h3>
                <div className={`rc-status ${connected ? 'online' : 'offline'}`}>
                    <span className="rc-dot"></span> {connected ? 'Connected' : 'Disconnected'}
                </div>
            </div>

            {error && <div className="rc-error">{error}</div>}

            <form className="rc-connect-form" onSubmit={handleConnect}>
                <label className="rc-label">Enter User Passcode</label>
                <div className="rc-input-row">
                    <input
                        type="text"
                        className="rc-passcode-input"
                        value={passcodeInput}
                        onChange={e => setPasscodeInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder="000000"
                        maxLength={6}
                        inputMode="numeric"
                    />
                    <button type="submit" className="rc-btn rc-btn-primary" disabled={passcodeInput.length !== 6 || !connected}>
                        Connect
                    </button>
                </div>
            </form>

            <div className="rc-users-section">
                <div className="rc-label">Online Users <span className="rc-count">{onlineUsers.length}</span></div>
                {onlineUsers.length === 0 ? (
                    <div className="rc-empty">No users online</div>
                ) : (
                    <div className="rc-users-list">
                        {onlineUsers.map(u => (
                            <div key={u.userId} className="rc-user-item">
                                <div className="rc-user-dot"></div>
                                <div className="rc-user-info">
                                    <span className="rc-user-name">{u.username}</span>
                                    {u.adminName && <span className="rc-user-admin">via {u.adminName}</span>}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
