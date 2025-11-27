import React, { useState } from 'react';
import { motion } from 'framer-motion';
import SettingsPopover from './SettingsPopover';
import './CommandDock.css';

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
    speed,
    setSpeed
}) {
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);

    return (
        <motion.div
            className="dock-wrapper"
            drag
            dragMomentum={false}
            initial={{ y: 100, opacity: 0, x: "-50%" }}
            animate={{ y: 0, opacity: 1, x: "-50%" }}
            style={{ x: "-50%" }} // Keep centered initially
        >
            <SettingsPopover isOpen={isSettingsOpen} speed={speed} setSpeed={setSpeed} />

            <div className="dock">
                {/* Drag Handle */}
                <div className="drag-handle" title="Drag to move">
                    <svg className="icon" viewBox="0 0 24 24" style={{ width: 14, height: 14 }}>
                        <circle cx="9" cy="12" r="1"></circle>
                        <circle cx="9" cy="5" r="1"></circle>
                        <circle cx="9" cy="19" r="1"></circle>
                        <circle cx="15" cy="12" r="1"></circle>
                        <circle cx="15" cy="5" r="1"></circle>
                        <circle cx="15" cy="19" r="1"></circle>
                    </svg>
                </div>

                {/* Settings Toggle */}
                <button
                    className={`dock-btn ${isSettingsOpen ? 'active' : ''}`}
                    onClick={() => setIsSettingsOpen(!isSettingsOpen)}
                >
                    <svg className="icon" viewBox="0 0 24 24">
                        <circle cx="12" cy="12" r="3"></circle>
                        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                    </svg>
                </button>

                <div className="divider"></div>

                {/* Start Button */}
                {!isSessionActive ? (
                    <button className="dock-btn" onClick={onStart} style={{ color: 'var(--lux-cyan)' }}>
                        <svg className="icon" viewBox="0 0 24 24">
                            <polygon points="5 3 19 12 5 21 5 3"></polygon>
                        </svg>
                        Start
                    </button>
                ) : (
                    <button className="dock-btn" onClick={onStop} style={{ color: 'var(--lux-rose)' }}>
                        <svg className="icon" viewBox="0 0 24 24">
                            <rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect>
                        </svg>
                        Stop
                    </button>
                )}

                <div className="divider"></div>

                {/* Analyze Button */}
                <button className="dock-btn analyze" onClick={onAnalyze} disabled={!isSessionActive}>
                    <svg className="icon" viewBox="0 0 24 24">
                        <path d="M21 12a9 9 0 1 1-6.219-8.56"></path>
                    </svg>
                    Analyze Screen
                </button>

                <div className="divider"></div>

                {/* Expand Button */}
                <button
                    className="dock-btn"
                    onClick={onExpand}
                    disabled={!canExpand}
                    title="Expand Answer"
                >
                    {isExpanding ? (
                        <svg className="icon" viewBox="0 0 24 24" className="spin">
                            <circle cx="12" cy="12" r="10"></circle>
                            <path d="M12 6v6l4 2"></path>
                        </svg>
                    ) : (
                        <svg className="icon" viewBox="0 0 24 24">
                            <polyline points="15 3 21 3 21 9"></polyline>
                            <polyline points="9 21 3 21 3 15"></polyline>
                            <line x1="21" y1="3" x2="14" y2="10"></line>
                            <line x1="3" y1="21" x2="10" y2="14"></line>
                        </svg>
                    )}
                </button>

                {/* Mute Button */}
                <button
                    className={`dock-btn ${isMuted ? 'active' : ''}`}
                    onClick={onMute}
                    disabled={!isSessionActive}
                >
                    {isMuted ? (
                        <svg className="icon" viewBox="0 0 24 24">
                            <line x1="1" y1="1" x2="23" y2="23"></line>
                            <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path>
                            <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.235"></path>
                            <line x1="12" y1="19" x2="12" y2="23"></line>
                            <line x1="8" y1="23" x2="16" y2="23"></line>
                        </svg>
                    ) : (
                        <svg className="icon" viewBox="0 0 24 24">
                            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                            <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                            <line x1="12" y1="19" x2="12" y2="23"></line>
                            <line x1="8" y1="23" x2="16" y2="23"></line>
                        </svg>
                    )}
                </button>

                {/* Clear Button */}
                <button className="dock-btn" onClick={onClear}>
                    <svg className="icon" viewBox="0 0 24 24">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                </button>
            </div>
        </motion.div>
    );
}
