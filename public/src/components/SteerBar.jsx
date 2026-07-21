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
export default function SteerBar({ nudges, suggestions = [], onToggle, onClear, onSendNow, onExtend, canExtend, isExtending }) {
    const [draft, setDraft] = useState('');

    // Default action (Enter + Queue button): queue the nudge to ride along with
    // the interviewer's next question.
    const queueDraft = (e) => {
        if (e) e.preventDefault();
        const text = draft.trim();
        if (!text) return;
        if (!nudges.includes(text)) onToggle(text);
        setDraft('');
    };

    // Second button: force the model to answer this nudge right now.
    const sendDraftNow = () => {
        const text = draft.trim();
        if (!text || !onSendNow) return;
        onSendNow(text);
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
                {onExtend && (
                    <button
                        type="button"
                        className={`steer-chip extend ${isExtending ? 'busy' : ''}`}
                        onClick={onExtend}
                        disabled={!canExtend || isExtending}
                        title={canExtend ? 'Extend the last answer — same points and example, just longer' : 'Answer something first, then extend it'}
                    >
                        {isExtending ? (
                            <span className="steer-spin" aria-hidden="true" />
                        ) : (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <line x1="3" y1="6" x2="21" y2="6"></line>
                                <line x1="3" y1="12" x2="21" y2="12"></line>
                                <line x1="3" y1="18" x2="14" y2="18"></line>
                            </svg>
                        )}
                        {isExtending ? 'Extending…' : 'Extend last answer'}
                    </button>
                )}
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
                <form className="steer-input" onSubmit={queueDraft}>
                    <input
                        type="text"
                        value={draft}
                        maxLength={80}
                        placeholder="Type your own nudge..."
                        onChange={(e) => setDraft(e.target.value)}
                    />
                    <button
                        type="submit"
                        className="steer-btn queue"
                        title="Queue for the next question (Enter)"
                        disabled={!draft.trim()}
                    >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="12" y1="5" x2="12" y2="19"></line>
                            <line x1="5" y1="12" x2="19" y2="12"></line>
                        </svg>
                    </button>
                    <button
                        type="button"
                        className="steer-btn now"
                        title="Answer now"
                        disabled={!draft.trim() || !onSendNow}
                        onClick={sendDraftNow}
                    >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                            <polygon points="13 2 3 14 11 14 11 22 21 10 13 10 13 2"></polygon>
                        </svg>
                    </button>
                </form>
            </div>
        </div>
    );
}
