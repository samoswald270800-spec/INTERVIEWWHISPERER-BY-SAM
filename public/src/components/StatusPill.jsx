import React from 'react';
import './StatusPill.css';

/**
 * Floating chrome status pill (IW Console v8).
 * [SUPERADMIN] · dot · STATUS · timer · credits
 */
export default function StatusPill({
    status,
    isListening,
    isProcessing,
    isSessionActive = false,
    timerLabel = null,
    timerWarning = false,
    creditsLabel = null,
    superAdmin = false,
}) {
    const live = isSessionActive || isListening || isProcessing;
    return (
        <div className="status-pill" role="status" aria-live="polite">
            {superAdmin && (
                <>
                    <span className="status-pill-identity">Superadmin</span>
                    <span className="status-pill-divider" />
                </>
            )}
            <span className={`status-pill-dot ${live ? 'live' : ''}`} />
            <span className="status-pill-text">{status || 'SYSTEM READY'}</span>
            {timerLabel !== null && (
                <>
                    <span className="status-pill-divider" />
                    <span className={`status-pill-timer ${live ? 'live' : ''} ${timerWarning ? 'warning' : ''}`}>
                        {timerLabel}
                    </span>
                </>
            )}
            {creditsLabel !== null && (
                <>
                    <span className="status-pill-divider" />
                    <span className="status-pill-credits" title="Credits">{creditsLabel}</span>
                </>
            )}
        </div>
    );
}
