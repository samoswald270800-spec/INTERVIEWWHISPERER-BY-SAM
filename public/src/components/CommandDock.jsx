import React, { useEffect, useRef, useState } from 'react';
import './CommandDock.css';

const DOCK_POSITION_KEY = 'iw-dock-pos';

function loadDockPosition() {
    try {
        const saved = JSON.parse(localStorage.getItem(DOCK_POSITION_KEY) || 'null');
        if (saved && typeof saved.x === 'number' && typeof saved.y === 'number') {
            return {
                x: Math.max(8, Math.min(saved.x, window.innerWidth - 260)),
                y: Math.max(8, Math.min(saved.y, window.innerHeight - 64)),
            };
        }
    } catch { /* storage optional */ }
    return null;
}

/**
 * Floating command dock (IW Console v8).
 * Draggable via the 6-dot grab handle; position clamped to the window and
 * persisted to localStorage.
 */
export default function CommandDock({
    onStart,
    onStop,
    onAnalyze,
    onClear,
    onMute,
    onExpand,
    isSessionActive,
    isMuted,
    canExpand,
    isExpanding,
    canAnalyze = true,
    isMobile = false,
}) {
    const dockRef = useRef(null);
    const [position, setPosition] = useState(loadDockPosition);
    const positionRef = useRef(position);

    useEffect(() => {
        positionRef.current = position;
    }, [position]);

    const startDrag = (event) => {
        const el = dockRef.current;
        if (!el || event.button !== 0) return;
        event.preventDefault();
        const rect = el.getBoundingClientRect();
        const offsetX = event.clientX - rect.left;
        const offsetY = event.clientY - rect.top;

        const move = (ev) => {
            const next = {
                x: Math.min(Math.max(8, ev.clientX - offsetX), window.innerWidth - rect.width - 8),
                y: Math.min(Math.max(8, ev.clientY - offsetY), window.innerHeight - rect.height - 8),
            };
            positionRef.current = next;
            setPosition(next);
        };
        const up = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            try {
                if (positionRef.current) {
                    localStorage.setItem(DOCK_POSITION_KEY, JSON.stringify(positionRef.current));
                }
            } catch { /* storage optional */ }
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
    };

    const positionStyle = position
        ? { left: `${position.x}px`, top: `${position.y}px`, bottom: 'auto', transform: 'none' }
        : undefined;

    const toolsEnabled = isSessionActive;

    return (
        <div className="command-dock" ref={dockRef} style={positionStyle}>
            <span
                className="dock-grab"
                title="Drag to move"
                onPointerDown={startDrag}
            >
                <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor">
                    <circle cx="2.5" cy="2.5" r="1.4" /><circle cx="7.5" cy="2.5" r="1.4" />
                    <circle cx="2.5" cy="8" r="1.4" /><circle cx="7.5" cy="8" r="1.4" />
                    <circle cx="2.5" cy="13.5" r="1.4" /><circle cx="7.5" cy="13.5" r="1.4" />
                </svg>
            </span>

            {!isSessionActive ? (
                <button className="dock-primary" onClick={onStart}>
                    Start session
                    <span className="dock-kbd">S</span>
                </button>
            ) : (
                <button className="dock-primary stop" onClick={onStop}>
                    Stop session
                    <span className="dock-kbd">S</span>
                </button>
            )}

            {!isMobile && (
                <>
                    <button
                        className={`dock-tool ${toolsEnabled && canAnalyze ? 'enabled' : ''}`}
                        onClick={onAnalyze}
                        disabled={!isSessionActive || !canAnalyze}
                        title={!canAnalyze ? 'Screen analysis disabled by admin' : 'Analyze screen'}
                    >
                        Analyze screen
                        <span className="dock-kbd dim">A</span>
                    </button>

                    <button
                        className={`dock-tool ${canExpand ? 'enabled' : ''}`}
                        onClick={onExpand}
                        disabled={!canExpand}
                        title="Expand answer"
                    >
                        {isExpanding ? (
                            <svg className="icon spin" width="13" height="13" viewBox="0 0 24 24">
                                <circle cx="12" cy="12" r="10"></circle>
                                <path d="M12 6v6l4 2"></path>
                            </svg>
                        ) : 'Expand'}
                        <span className="dock-kbd dim">E</span>
                    </button>
                </>
            )}

            <span className="dock-divider" />

            <button
                className={`dock-icon-btn ${isMuted ? 'muted' : ''}`}
                onClick={onMute}
                disabled={!isSessionActive}
                title="Mute microphone · M"
            >
                {isMuted ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="1" y1="1" x2="23" y2="23"></line>
                        <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path>
                        <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.235"></path>
                        <line x1="12" y1="19" x2="12" y2="23"></line>
                    </svg>
                ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                        <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                        <line x1="12" y1="19" x2="12" y2="23"></line>
                    </svg>
                )}
            </button>

            <button className="dock-icon-btn clear" onClick={onClear} title="Clear transcript">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
            </button>
        </div>
    );
}
