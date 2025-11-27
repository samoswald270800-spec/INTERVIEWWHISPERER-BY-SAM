import React from 'react';
import './SettingsPopover.css';

export default function SettingsPopover({ isOpen, speed, setSpeed }) {
    return (
        <div className={`settings-popover ${isOpen ? 'open' : ''}`}>
            <div className="setting-group">
                <div className="setting-label">
                    Text Speed
                    <span style={{ color: 'var(--text-white)' }}>
                        {speed < 10 ? "Instant" : speed < 25 ? "Normal" : "Relaxed"}
                    </span>
                </div>
                <div className="range-wrap">
                    <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Slow</span>
                    <input
                        type="range"
                        min="5"
                        max="50"
                        value={55 - speed} // Invert for UI logic (Left=Slow, Right=Fast in code, but UI label says opposite)
                        step="5"
                        onChange={(e) => setSpeed(55 - parseInt(e.target.value))}
                    />
                    <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Fast</span>
                </div>
            </div>
        </div>
    );
}
