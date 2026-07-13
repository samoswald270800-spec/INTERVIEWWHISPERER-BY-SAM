import React, { useState } from 'react';
import './JobDescription.css';

/**
 * Job description drawer (IW Console v8) — controlled by the parent view;
 * opened from the whisperer toolbar. Scrim is rendered by the parent.
 */
export default function JobDescription({ isOpen, onClose, jd, setJd, onSave }) {
    const [isSaved, setIsSaved] = useState(false);

    if (!isOpen) return null;

    const handleSave = async () => {
        const success = await onSave(jd);
        if (success) {
            setIsSaved(true);
            setTimeout(() => setIsSaved(false), 1500);
        }
    };

    return (
        <div className="iw-drawer jd-drawer">
            <div className="iw-drawer-header">
                <span className="iw-drawer-title">Job description</span>
                <div className="iw-drawer-spacer" />
                <button className="iw-drawer-close" onClick={onClose} title="Close">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
            </div>
            <div className="jd-drawer-body">
                <div className="jd-helper">Answers are tailored to this role. Paste the posting below.</div>
                <textarea
                    value={jd}
                    onChange={(e) => setJd(e.target.value)}
                    placeholder="Paste job description..."
                />
                <div className="jd-actions">
                    <button className="iw-primary-btn" onClick={handleSave}>
                        {isSaved ? 'Saved' : 'Save'}
                    </button>
                    <button className="iw-ghost-btn" onClick={() => setJd('')}>Clear</button>
                </div>
            </div>
        </div>
    );
}
