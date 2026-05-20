import React, { useState, useEffect } from 'react';
import './SettingsPopover.css';

export default function SettingsPopover({ isOpen, speed, setSpeed, visionModel, setVisionModel, interviewMode, setInterviewMode, architecture, setArchitecture, permissions = {}, lockedFeatures = {}, opacity, setOpacity, isMobile = false }) {
    const [userRole, setUserRole] = useState(null);
    const [dashboardUrl, setDashboardUrl] = useState(null);

    useEffect(() => {
        fetch('/api/me')
            .then(res => res.json())
            .then(data => {
                setUserRole(data.role);
                setDashboardUrl(data.dashboardUrl);
            })
            .catch(() => { });
    }, []);

    const getSpeedLabel = () => {
        if (speed === 0) return "Instant";
        if (speed < 10) return "Blazing";
        if (speed < 25) return "Normal";
        return "Relaxed";
    };

    const handleLogout = async () => {
        try {
            await fetch('/api/logout', { method: 'POST' });
            window.location.href = '/login';
        } catch (e) {
            window.location.href = '/login';
        }
    };

    const goToDashboard = () => {
        if (dashboardUrl) {
            window.location.href = dashboardUrl;
        }
    };

    const LockBadge = ({ feature }) => {
        if (!lockedFeatures[feature]) return null;
        return (
            <span className="lock-badge" title="Premium Users Only">
                <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                    <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                </svg>
            </span>
        );
    };

    const handleArchitectureChange = (arch) => {
        // Block if the architecture is locked (SA lock) or disabled (admin permission)
        if (arch === 'reasoning' && (lockedFeatures.canReasoning || permissions.canReasoning === false)) return;
        if (arch === 'turbo' && (lockedFeatures.canTurbo || permissions.canTurbo === false)) return;
        setArchitecture(arch);
    };

    return (
        <div className={`settings-popover ${isOpen ? 'open' : ''}`}>
            <div className="settings-header">
                <h3>Preferences</h3>
            </div>

            <div className="setting-group">
                <div className="setting-label">
                    ARCHITECTURE <span>System Core</span>
                </div>
                <div className="architecture-selector">
                    <div className="arch-slider-container">
                        <div 
                            className="arch-slider" 
                            style={{ 
                                transform: `translateX(${
                                    architecture === 'live' ? '0%' : 
                                    architecture === 'reasoning' ? '100%' : '200%'
                                })` 
                            }} 
                        />
                    </div>
                    <button
                        className={`arch-btn ${architecture === 'live' ? 'active' : ''}`}
                        onClick={() => handleArchitectureChange('live')}
                    >
                        Live
                    </button>
                    <button
                        className={`arch-btn ${architecture === 'reasoning' ? 'active' : ''} ${(lockedFeatures.canReasoning || permissions.canReasoning === false) ? 'arch-locked' : ''}`}
                        onClick={() => handleArchitectureChange('reasoning')}
                        title={(lockedFeatures.canReasoning || permissions.canReasoning === false) ? "Premium Users Only" : ""}
                    >
                        {(lockedFeatures.canReasoning || permissions.canReasoning === false) && <LockBadge feature="canReasoning" />}
                        Reasoning
                    </button>
                    <button
                        className={`arch-btn ${architecture === 'turbo' ? 'active' : ''} ${(lockedFeatures.canTurbo || permissions.canTurbo === false) ? 'arch-locked' : ''}`}
                        onClick={() => handleArchitectureChange('turbo')}
                        title={(lockedFeatures.canTurbo || permissions.canTurbo === false) ? "Premium Users Only" : ""}
                    >
                        {(lockedFeatures.canTurbo || permissions.canTurbo === false) && <LockBadge feature="canTurbo" />}
                        Turbo
                    </button>
                </div>
            </div>

            <div className="setting-group">
                <div className="setting-label">
                    TEXT SPEED
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
                        style={{ '--val': `${((50 - speed) / 50) * 100}%` }}
                    />
                    <span className="range-icon">⚡</span>
                </div>
            </div>

            {/* ELECTRON ONLY: Window Opacity */}
            {window.electron && window.electron.isElectron && (
                <div className="setting-group">
                    <div className="setting-label">
                        Window Opacity
                        <span className="value-badge">{Math.round(opacity * 100)}%</span>
                    </div>
                    <div className="range-wrap">
                        <span className="range-icon" title="More Transparent">👻</span>
                        <input
                            type="range"
                            min="0.2"
                            max="1.0"
                            step="0.05"
                            value={opacity}
                            onChange={(e) => setOpacity(parseFloat(e.target.value))}
                            onPointerDown={(e) => e.stopPropagation()}
                        />
                        <span className="range-icon" title="Opaque">⬛</span>
                    </div>
                </div>
            )}

            {/* DESKTOP ONLY: Vision Model */}
            {!isMobile && (
                <div className="setting-group">
                    <div className="setting-label">VISION MODEL</div>
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
            )}

            <div className="setting-group">
                <div className="setting-label">INTERVIEW MODE</div>
                <div className="mode-grid">
                    <button
                        className={`mode-card ${interviewMode === 'smart' ? 'active' : ''}`}
                        onClick={() => setInterviewMode('smart')}
                    >
                        <span className="mode-icon">💡</span>
                        <div className="mode-text">
                            <span className="mode-name">Smart Detail</span>
                            <span className="mode-desc">Advanced context synthesis</span>
                        </div>
                    </button>
                    <button
                        className={`mode-card ${interviewMode === 'hr' ? 'active' : ''}`}
                        onClick={() => setInterviewMode('hr')}
                    >
                        <span className="mode-icon">🤝</span>
                        <div className="mode-text">
                            <span className="mode-name">HR Focus</span>
                            <span className="mode-desc">Soft skills & cultural fit</span>
                        </div>
                    </button>
                    <button
                        className={`mode-card ${interviewMode === 'technical' ? 'active' : ''}`}
                        onClick={() => setInterviewMode('technical')}
                    >
                        <span className="mode-icon">⚙️</span>
                        <div className="mode-text">
                            <span className="mode-name">Technical</span>
                            <span className="mode-desc">Deep dive architecture</span>
                        </div>
                    </button>
                    <button
                        className={`mode-card ${interviewMode === 'vp' ? 'active' : ''}`}
                        onClick={() => setInterviewMode('vp')}
                    >
                        <span className="mode-icon">🎯</span>
                        <div className="mode-text">
                            <span className="mode-name">VP Level</span>
                            <span className="mode-desc">Strategy & outcomes</span>
                        </div>
                    </button>
                </div>
            </div>

            {/* Dashboard Link - Show for admin and super_admin */}
            {dashboardUrl && (userRole === 'admin' || userRole === 'super_admin') && (
                <div className="setting-group">
                    <div className="settings-divider"></div>
                    <button className="dashboard-btn" onClick={goToDashboard}>
                        <span className="dashboard-btn-text">
                            {userRole === 'super_admin' ? 'Super Admin Dashboard' : 'Admin Dashboard'}
                        </span>
                        <span className="dashboard-btn-arrow">→</span>
                    </button>
                </div>
            )}

            {/* Logout Button */}
            <div className="setting-group logout-group">
                <button className="logout-btn" onClick={handleLogout}>
                    Sign Out
                </button>
            </div>
        </div>
    );
}
