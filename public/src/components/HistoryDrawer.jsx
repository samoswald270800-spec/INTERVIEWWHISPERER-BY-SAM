import React from 'react';
import './HistoryDrawer.css';

function formatMeta(item) {
    const parts = [];
    if (item.created_at) {
        parts.push(new Date(item.created_at).toLocaleString([], {
            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
        }));
    }
    const questions = Array.isArray(item.qa_list) ? item.qa_list.length : null;
    if (questions !== null) parts.push(`${questions} question${questions === 1 ? '' : 's'}`);
    return parts.join(' · ');
}

/**
 * Session history drawer (IW Console v8) — slides in from the left edge
 * below the chrome. Scrim is rendered by the parent view.
 */
export default function HistoryDrawer({
    isOpen,
    onClose,
    history,
    onSelect,
    onDelete,
    onNewInterview,
}) {
    if (!isOpen) return null;

    return (
        <div className="iw-drawer history-drawer">
            <div className="iw-drawer-header">
                <span className="iw-drawer-title">Session history</span>
                <span className="iw-drawer-count">
                    {history.length} session{history.length === 1 ? '' : 's'}
                </span>
                <div className="iw-drawer-spacer" />
                <button
                    className="iw-drawer-action"
                    onClick={() => { onNewInterview(); onClose(); }}
                    title="Save current and start a new interview"
                >
                    <svg viewBox="0 0 24 24" width="10" height="10" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round">
                        <line x1="12" y1="5" x2="12" y2="19"></line>
                        <line x1="5" y1="12" x2="19" y2="12"></line>
                    </svg>
                    New
                </button>
                <button className="iw-drawer-close" onClick={onClose} title="Close">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
            </div>
            <div className="iw-drawer-body history-list">
                {history.length === 0 ? (
                    <div className="history-empty">No sessions yet.</div>
                ) : (
                    history.map((item) => (
                        <div className="history-row" key={item.id}>
                            <button
                                className="history-row-main"
                                onClick={() => { onSelect(item); onClose(); }}
                            >
                                <span className="history-row-name">{item.name}</span>
                                <span className="history-row-meta">{formatMeta(item)}</span>
                            </button>
                            <button
                                className="history-row-delete"
                                onClick={(e) => { e.stopPropagation(); onDelete(item.id); }}
                                title="Delete session"
                            >
                                <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="3 6 5 6 21 6"></polyline>
                                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                </svg>
                            </button>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
