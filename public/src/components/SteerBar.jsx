import React, { useState } from 'react';
import './SteerBar.css';

const STATIC_CHIPS = [
    'Crack a light joke',
    'Ask them a question back',
    'Keep it under 30 seconds',
];

function Sparkle() {
    return (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 2l2.2 6.6L21 11l-6.8 2.4L12 20l-2.2-6.6L3 11l6.8-2.4L12 2z" />
        </svg>
    );
}

/**
 * "Steer the next answer" bar (below the live transcript).
 * Chips + a free-text nudge queue that rides along with the interviewer's
 * next question — mixed into the model context, never into the transcript.
 */
export default function SteerBar({ nudges, suggestions = [], onToggle, onClear }) {
    const [draft, setDraft] = useState('');

    const submitDraft = (e) => {
        e.preventDefault();
        const text = draft.trim();
        if (!text) return;
        if (!nudges.includes(text)) onToggle(text);
        setDraft('');
    };

    // Static chips → dynamic suggestions (sparkle) → custom queued nudges
    const seen = new Set();
    const chips = [];
    STATIC_CHIPS.forEach((text) => { seen.add(text); chips.push({ text, dynamic: false }); });
    suggestions.forEach((text) => {
        if (!text || seen.has(text)) return;
        seen.add(text);
        chips.push({ text, dynamic: true });
    });
    nudges.forEach((text) => {
        if (seen.has(text)) return;
        seen.add(text);
        chips.push({ text, dynamic: false, custom: true });
    });

    return (
        <div className="steer-bar">
            <div className="steer-head">
                <span className="steer-dot" />
                <span className="iw-eyebrow steer-title">Steer the next answer</span>
                <div className="steer-spacer" />
                {nudges.length > 0 && (
                    <>
                        <span className="steer-queue">
                            {nudges.length} queued · rides with the next question
                        </span>
                        <button className="steer-clear" onClick={onClear}>Clear</button>
                    </>
                )}
            </div>
            <div className="steer-chips">
                {chips.map((chip) => {
                    const active = nudges.includes(chip.text);
                    return (
                        <button
                            key={chip.text}
                            className={`steer-chip ${active ? 'active' : ''}`}
                            onClick={() => onToggle(chip.text)}
                            title={active ? 'Remove from queue' : 'Queue for the next answer'}
                        >
                            {chip.dynamic && <span className="steer-sparkle"><Sparkle /></span>}
                            {chip.text}
                        </button>
                    );
                })}
                <form className="steer-input" onSubmit={submitDraft}>
                    <input
                        type="text"
                        value={draft}
                        maxLength={80}
                        placeholder="Type your own nudge..."
                        onChange={(e) => setDraft(e.target.value)}
                    />
                    <button type="submit" className="steer-send" title="Queue nudge" disabled={!draft.trim()}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="12" y1="19" x2="12" y2="5"></line>
                            <polyline points="5 12 12 5 19 12"></polyline>
                        </svg>
                    </button>
                </form>
            </div>
        </div>
    );
}
