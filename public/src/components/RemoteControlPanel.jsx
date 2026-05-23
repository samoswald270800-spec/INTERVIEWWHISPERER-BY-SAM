/**
 * RemoteControlPanel — Admin-side remote control UI
 * Shows online users, passcode input, screen viewer
 */

import React, { useState } from 'react';
import './RemoteControlPanel.css';

export default function RemoteControlPanel({
    connected, onlineUsers, error, waitingConsent,
    remoteSession, screenFrame,
    connectWithPasscode, sendInputEvent, endSession
}) {
    const [passcodeInput, setPasscodeInput] = useState('');

    const handleConnect = (e) => {
        e.preventDefault();
        if (passcodeInput.length === 6) {
            connectWithPasscode(passcodeInput);
            setPasscodeInput('');
        }
    };

    // Active remote session view
    if (remoteSession) {
        return (
            <div className="rc-panel">
                <div className="rc-header">
                    <div className="rc-status live">
                        <span className="rc-dot"></span> Live Session — {remoteSession.username || 'User'}
                    </div>
                    <button className="rc-btn rc-btn-danger" onClick={endSession}>End Session</button>
                </div>
                <div className="rc-screen-viewer">
                    {screenFrame ? (
                        <img src={screenFrame} alt="User screen" className="rc-screen-img" />
                    ) : (
                        <div className="rc-screen-placeholder">
                            <div className="rc-screen-icon">🖥️</div>
                            <p>Waiting for screen data...</p>
                            <p className="rc-sub">User's screen will appear here once streaming begins</p>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // Waiting for consent
    if (waitingConsent) {
        return (
            <div className="rc-panel">
                <div className="rc-waiting">
                    <div className="rc-spinner"></div>
                    <h3>Waiting for consent</h3>
                    <p>Asking <strong>{waitingConsent}</strong> for permission...</p>
                    <p className="rc-sub">The user must accept the connection request</p>
                </div>
            </div>
        );
    }

    // Default: connect form + online users
    return (
        <div className="rc-panel">
            <div className="rc-header">
                <h3 className="rc-title">Remote Control</h3>
                <div className={`rc-status ${connected ? 'online' : 'offline'}`}>
                    <span className="rc-dot"></span> {connected ? 'Socket Connected' : 'Disconnected'}
                </div>
            </div>

            {error && <div className="rc-error">{error}</div>}

            {/* Passcode Connect */}
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

            {/* Online Users */}
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
