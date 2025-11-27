import React from 'react';
import './SettingsPopover.css';

export default function SettingsPopover({ isOpen, speed, setSpeed }) {
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
        </div>
    );
}
