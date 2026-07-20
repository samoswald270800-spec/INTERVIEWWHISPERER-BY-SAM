import React, { useEffect, useRef } from 'react';
import { copyText } from '../utils/clipboard';
import './QAList.css';

/**
 * Live transcript (IW Console v8).
 * Empty state: centered wordmark. Active: floating glass card with Q/A turns.
 */
export default function QAList({ qaList, onManualSearch, onRegenerate, isProcessing = false, steerBar = null }) {
    const listRef = useRef(null);

    useEffect(() => {
        if (listRef.current) {
            listRef.current.scrollTop = listRef.current.scrollHeight;
        }
    }, [qaList]);

    const copyAnswer = (answer) => {
        if (!answer) return;
        copyText(answer);
    };

    // Empty state only when there's nothing to show at all (no turns, and no
    // steer bar — i.e. no active session). During an active session the panel
    // renders so the steer bar is available before the first question lands.
    if (qaList.length === 0 && !steerBar) {
        return (
            <div className="transcript-empty">
                <div className="transcript-wordmark">Interview Whisperer</div>
                <div className="transcript-tagline">
                    Start the session to capture the call. Questions transcribe live; answers draft instantly.
                </div>
            </div>
        );
    }

    return (
        <div className="transcript-panel" ref={listRef}>
            <div className="transcript-column">
                {qaList.map((qa, index) => {
                    const isLast = index === qaList.length - 1;
                    const streaming = isLast && isProcessing;
                    return (
                        <div className="transcript-turn" key={index}>
                            <span className={`turn-badge q ${qa.direct ? 'direct' : ''}`}>
                                {qa.direct ? 'You' : `Q${index + 1}`}
                            </span>
                            <div className="turn-question-row">
                                <span className={`turn-question ${qa.direct ? 'direct' : ''}`}>{qa.question}</span>
                                {qa.time && <span className="turn-time">{qa.time}</span>}
                            </div>
                            <span className="turn-badge iw">IW</span>
                            <div>
                                <div className="turn-answer">
                                    {qa.answer}
                                    {streaming && <span className="turn-cursor" />}
                                </div>
                                {!streaming && (
                                    <div className="turn-actions">
                                        <button onClick={() => copyAnswer(qa.answer)}>Copy</button>
                                        {onRegenerate && (
                                            <button onClick={() => onRegenerate(index, qa.question)}>Regenerate</button>
                                        )}
                                        {onManualSearch && (
                                            <button onClick={() => onManualSearch(index, qa.question)}>Search web</button>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
                {steerBar}
            </div>
        </div>
    );
}
