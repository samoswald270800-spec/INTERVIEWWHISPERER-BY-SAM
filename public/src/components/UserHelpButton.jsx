/**
 * UserHelpButton — User-side remote control UI
 * Small floating button to request help + show passcode + consent dialog
 */

import React, { useState } from 'react';
import './UserHelpButton.css';

export default function UserHelpButton({
    connected, passcode, consentRequest, remoteSession,
    requestHelp, refreshPasscode, respondConsent, endSession
}) {
    const [expanded, setExpanded] = useState(false);

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
                <span>Admin is viewing your screen</span>
                <button className="uh-btn uh-btn-end" onClick={endSession}>End</button>
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
