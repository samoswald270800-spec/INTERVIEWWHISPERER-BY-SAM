import React from 'react';
import './SettingsPopover.css';

export default function SettingsPopover({ isOpen, speed, setSpeed, visionModel, setVisionModel, interviewMode, setInterviewMode }) {
    const getSpeedLabel = () => {
        if (speed === 0) return "Instant";
        if (speed < 10) return "Blazing";
        if (speed < 25) return "Normal";
        return "Relaxed";
    };

    return (
        <div className={`settings-popover ${isOpen ? 'open' : ''}`}>
            <div className="settings-header">
                <h3>Preferences</h3>
            </div>

            <div className="setting-group">
                <div className="setting-label">
                    Text Speed
                    <span className="value-badge">{getSpeedLabel()}</span>
                </div>
                <div className="range-wrap">
                    <span className="range-icon">🐢</span>
                    <input
                        type="range"
                        min="0"
                        max="50"
                        value={50 - speed}
                        step="5"
                        onChange={(e) => setSpeed(50 - parseInt(e.target.value))}
                        onPointerDown={(e) => e.stopPropagation()}
                    />
                    <span className="range-icon">⚡</span>
                </div>
            </div>

            <div className="setting-group">
                <div className="setting-label">Vision Model</div>
                <div className="model-selector">
                    <button
                        className={`model-btn ${visionModel === 'openai' ? 'active' : ''}`}
                        onClick={() => setVisionModel('openai')}
                    >
                        GPT-4o
                    </button>
                    <button
                        className={`model-btn ${visionModel === 'anthropic' ? 'active' : ''}`}
                        onClick={() => setVisionModel('anthropic')}
                    >
                        Claude 3.5
                    </button>
                </div>
            </div>

            <div className="setting-group">
                <div className="setting-label">Interview Mode</div>
                <div className="mode-grid">
                    <button
                        className={`mode-card ${interviewMode === 'smart' ? 'active' : ''}`}
                        onClick={() => setInterviewMode('smart')}
                    >
                        <span className="mode-icon">💡</span>
                        <span className="mode-name">Smart Detail</span>
                    </button>
                    <button
                        className={`mode-card ${interviewMode === 'hr' ? 'active' : ''}`}
                        onClick={() => setInterviewMode('hr')}
                    >
                        <span className="mode-icon">🤝</span>
                        <span className="mode-name">HR Focus</span>
                    </button>
                    <button
                        className={`mode-card ${interviewMode === 'technical' ? 'active' : ''}`}
                        onClick={() => setInterviewMode('technical')}
                    >
                        <span className="mode-icon">⚙️</span>
                        <span className="mode-name">Technical</span>
                    </button>
                    <button
                        className={`mode-card ${interviewMode === 'vp' ? 'active' : ''}`}
                        onClick={() => setInterviewMode('vp')}
                    >
                        <span className="mode-icon">🎯</span>
                        <span className="mode-name">VP Level</span>
                    </button>
                </div>
            </div>
        </div>
    );
}
