import React, { useEffect, useState } from 'react';
import SuperAdminDashboard from './SuperAdminDashboard';
import StatusPill from './StatusPill';
import './SuperAdminWorkspace.css';

/**
 * Superadmin console (IW Console v8).
 * Full-window shell with floating chrome (status pill, view toggle, sign out)
 * and a 200%-wide sliding track holding the Whisperer tool and the dashboard.
 *
 * Replaces the previous preset/split-pane workspace; the drag-resizer code it
 * used lives in git history should a split view ever be revived.
 */
export default function SuperAdminWorkspace({
    interviewContent,
    camera,
    status,
    isListening,
    isProcessing,
    isSessionActive,
    timerLabel,
    timerWarning,
    creditsLabel,
    onViewChange,
    onLogout,
}) {
    const [view, setView] = useState('whisperer');
    const onDashboard = view === 'dashboard';

    useEffect(() => {
        document.body.style.overflow = 'hidden';
        document.body.style.height = '100%';
        return () => {
            document.body.style.overflow = '';
            document.body.style.height = '';
        };
    }, []);

    const switchView = (next) => {
        setView(next);
        if (onViewChange) onViewChange(next);
    };

    // D toggles between the two views (ignored while typing).
    useEffect(() => {
        const onKey = (event) => {
            const tag = event.target && event.target.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || event.target?.isContentEditable) return;
            if (event.key.toLowerCase() === 'd') {
                switchView(view === 'whisperer' ? 'dashboard' : 'whisperer');
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    });

    return (
        <div className="console">
            <header className="console-chrome">
                <div className="console-pill-slot">
                    <StatusPill
                        status={status}
                        isListening={isListening}
                        isProcessing={isProcessing}
                        isSessionActive={isSessionActive}
                        timerLabel={timerLabel}
                        timerWarning={timerWarning}
                        creditsLabel={creditsLabel}
                        superAdmin
                    />
                </div>

                <div className="console-view-toggle" title="Switch view · D">
                    <span
                        className="console-toggle-thumb"
                        style={{ transform: `translateX(${onDashboard ? 126 : 0}px)` }}
                    />
                    <button
                        className={`console-toggle-tab ${!onDashboard ? 'active' : ''}`}
                        onClick={() => switchView('whisperer')}
                    >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                            <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                            <line x1="12" y1="19" x2="12" y2="23"></line>
                        </svg>
                        Whisperer
                    </button>
                    <button
                        className={`console-toggle-tab ${onDashboard ? 'active' : ''}`}
                        onClick={() => switchView('dashboard')}
                    >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3" y="3" width="7" height="7" rx="1.5"></rect>
                            <rect x="14" y="3" width="7" height="7" rx="1.5"></rect>
                            <rect x="14" y="14" width="7" height="7" rx="1.5"></rect>
                            <rect x="3" y="14" width="7" height="7" rx="1.5"></rect>
                        </svg>
                        Dashboard
                    </button>
                </div>

                <button className="console-signout" onClick={onLogout} title="Sign out">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                        <polyline points="16 17 21 12 16 7"></polyline>
                        <line x1="21" y1="12" x2="9" y2="12"></line>
                    </svg>
                </button>
            </header>

            <div className="console-viewport">
                <div className={`console-track ${onDashboard ? 'on-dashboard' : ''}`}>
                    <div className={`console-pane ${onDashboard ? 'faded' : ''}`} aria-label="Interview Whisperer">
                        {interviewContent}
                    </div>
                    <div className={`console-pane ${onDashboard ? '' : 'faded'}`} aria-label="Superadmin dashboard">
                        <SuperAdminDashboard embedded candidateCamera={camera} />
                    </div>
                </div>
            </div>
        </div>
    );
}
