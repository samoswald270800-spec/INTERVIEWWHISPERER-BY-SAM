import React from 'react';
import './HistoryDrawer.css';

export default function HistoryDrawer({
    isOpen,
    onClose,
    history,
    onSelect,
    onDelete,
    onNewInterview
}) {
    return (
        <>
            <div
                className={`history-backdrop ${isOpen ? 'open' : ''}`}
                onClick={onClose}
            />
            <div className={`history-drawer ${isOpen ? 'open' : ''}`}>
                <div className="drawer-header">
                    <h2>Interview History</h2>
                    <button className="close-btn" onClick={onClose}>
                        <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
                <div className="drawer-actions">
                    <button className="new-interview-btn" onClick={() => {
                        onNewInterview();
                        onClose();
                    }}>
                        <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="12" y1="5" x2="12" y2="19"></line>
                            <line x1="5" y1="12" x2="19" y2="12"></line>
                        </svg>
                        New Interview
                    </button>
                </div>
                <div className="history-list">
                    {history.length === 0 ? (
                        <div className="empty-state">No history yet.</div>
                    ) : (
                        history.map((item) => (
                            <div key={item.id} className="history-item">
                                <div
                                    className="history-item-content"
                                    onClick={() => {
                                        onSelect(item);
                                        onClose();
                                    }}
                                >
                                    <div className="history-name">{item.name}</div>
                                    <div className="history-date">
                                        {new Date(item.created_at).toLocaleString()}
                                    </div>
                                </div>
                                <button
                                    className="delete-btn"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        if (confirm('Delete this history item?')) onDelete(item.id);
                                    }}
                                    title="Delete"
                                >
                                    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
                                        <polyline points="3 6 5 6 21 6"></polyline>
                                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                    </svg>
                                </button>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </>
    );
}
