import React from 'react';
import './SettingsPopover.css';

const ENGINES = [
    { id: 'live', label: 'Live', lockKey: null, permKey: null, accent: 'green' },
    { id: 'reasoning', label: 'Reasoning', lockKey: 'canReasoning', permKey: 'canReasoning', accent: 'acc' },
    { id: 'turbo', label: 'Turbo', lockKey: 'canTurbo', permKey: 'canTurbo', accent: 'gold' },
];

const MODES = [
    { id: 'smart', label: 'Smart detail' },
    { id: 'hr', label: 'HR focus' },
    { id: 'technical', label: 'Technical' },
    { id: 'vp', label: 'VP level' },
];

const VISIONS = [
    { id: 'openai', label: 'GPT-4o' },
    { id: 'anthropic', label: 'Claude 3.5' },
];

function Padlock() {
    return (
        <svg viewBox="0 0 24 24" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="2.5">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
        </svg>
    );
}

/**
 * Preferences popover (IW Console v8) — opens upward from the round
 * preferences button bottom-left.
 */
export default function SettingsPopover({
    isOpen,
    speed,
    setSpeed,
    visionModel,
    setVisionModel,
    interviewMode,
    setInterviewMode,
    architecture,
    setArchitecture,
    permissions = {},
    lockedFeatures = {},
    opacity,
    setOpacity,
    isMobile = false,
}) {
    if (!isOpen) return null;

    const getSpeedLabel = () => {
        if (speed === 0) return 'Instant';
        if (speed < 10) return 'Blazing';
        if (speed < 25) return 'Normal';
        return 'Relaxed';
    };

    const isEngineLocked = (engine) =>
        Boolean(engine.lockKey && (lockedFeatures[engine.lockKey] || permissions[engine.permKey] === false));

    const pickEngine = (engine) => {
        if (isEngineLocked(engine)) return;
        setArchitecture(engine.id);
    };

    return (
        <div className="prefs-popover">
            <div className="prefs-section">
                <span className="iw-eyebrow">Engine</span>
                <div className="prefs-chips">
                    {ENGINES.map((engine) => {
                        const locked = isEngineLocked(engine);
                        const active = architecture === engine.id;
                        return (
                            <button
                                key={engine.id}
                                className={`prefs-chip ${active ? `active accent-${engine.accent}` : ''} ${locked ? 'locked' : ''}`}
                                onClick={() => pickEngine(engine)}
                                title={locked ? 'Premium users only' : ''}
                            >
                                {locked && <Padlock />}
                                {engine.label}
                            </button>
                        );
                    })}
                </div>
            </div>

            <div className="prefs-section">
                <span className="iw-eyebrow">Answer mode</span>
                <div className="prefs-chips">
                    {MODES.map((mode) => (
                        <button
                            key={mode.id}
                            className={`prefs-chip ${interviewMode === mode.id ? 'active accent-acc' : ''}`}
                            onClick={() => setInterviewMode(mode.id)}
                        >
                            {mode.label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="prefs-section">
                <div className="prefs-row">
                    <span className="iw-eyebrow">Text speed</span>
                    <span className="prefs-value">{getSpeedLabel()}</span>
                </div>
                <input
                    type="range"
                    min="0"
                    max="50"
                    step="5"
                    value={50 - speed}
                    onChange={(e) => setSpeed(50 - parseInt(e.target.value, 10))}
                    onPointerDown={(e) => e.stopPropagation()}
                />
            </div>

            {!isMobile && (
                <div className="prefs-section">
                    <span className="iw-eyebrow">Vision model</span>
                    <div className="prefs-chips">
                        {VISIONS.map((vision) => (
                            <button
                                key={vision.id}
                                className={`prefs-chip ${visionModel === vision.id ? 'active accent-acc' : ''}`}
                                onClick={() => setVisionModel(vision.id)}
                            >
                                {vision.label}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            <div className="prefs-section">
                <div className="prefs-row">
                    <span className="iw-eyebrow">Window opacity</span>
                    <span className="prefs-value">{Math.round(opacity * 100)}%</span>
                </div>
                <input
                    type="range"
                    min="0.2"
                    max="1.0"
                    step="0.05"
                    value={opacity}
                    onChange={(e) => setOpacity(parseFloat(e.target.value))}
                    onPointerDown={(e) => e.stopPropagation()}
                />
            </div>

            <div className="prefs-divider" />

            <div className="prefs-shortcuts">
                <span><span className="iw-kbd">S</span>Start</span>
                <span><span className="iw-kbd">M</span>Mute</span>
                <span><span className="iw-kbd">D</span>Dashboard</span>
            </div>
        </div>
    );
}
