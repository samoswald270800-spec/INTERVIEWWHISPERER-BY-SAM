import { useState } from 'react';
import './ScreenInsight.css';

/**
 * Screen-insight panel — surfaces the result of a screen analysis in the
 * empty right gutter during an interview. Phase 1 renders what the vision
 * model already returns (key points, how-to-answer, full breakdown); later
 * phases add screen-type-specific cards (code, chart, system design, …).
 *
 * Props:
 *   insight  — { keyPoints, answerGuidance, analysis, error } | null
 *   loading  — analysis in flight
 *   onClose  — hide the panel (does NOT re-run analysis)
 */
export default function ScreenInsight({ insight, loading, onClose }) {
  const [showFull, setShowFull] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!loading && !insight) return null;

  // key_points comes back as a newline / bullet string — normalize to items.
  const points = (insight?.keyPoints || '')
    .split(/\r?\n+/)
    .map((s) => s.replace(/^\s*(?:[•\-*•]|\d+[.)])\s*/, '').trim())
    .filter(Boolean);

  const copyAll = () => {
    const text = [
      points.length ? 'KEY POINTS\n' + points.map((p) => '• ' + p).join('\n') : '',
      insight?.answerGuidance ? 'HOW TO ANSWER\n' + insight.answerGuidance : '',
    ].filter(Boolean).join('\n\n');
    if (!text || !navigator.clipboard) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    }).catch(() => {});
  };

  return (
    <aside className="screen-insight" aria-label="Screen insight">
      <div className="si-head">
        <span className="si-dot" />
        <span className="iw-eyebrow">Screen insight</span>
        <span className="si-spacer" />
        {insight && !insight.error && (
          <button className="si-icon" onClick={copyAll} title="Copy insight" aria-label="Copy insight">
            {copied ? (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
            )}
          </button>
        )}
        <button className="si-icon" onClick={onClose} title="Hide" aria-label="Hide screen insight">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>
      </div>

      {loading ? (
        <div className="si-body">
          <div className="si-loading">
            <span className="si-spinner" />
            Reading the shared screen…
          </div>
          <div className="si-sk" />
          <div className="si-sk" />
          <div className="si-sk short" />
          <div className="si-sk" />
          <div className="si-sk short" />
        </div>
      ) : insight.error ? (
        <div className="si-body">
          <div className="si-error">{insight.error}</div>
        </div>
      ) : (
        <div className="si-body">
          {points.length > 0 && (
            <section className="si-sec">
              <div className="si-label">Key points</div>
              <ul className="si-points">
                {points.map((p, i) => <li key={i}>{p}</li>)}
              </ul>
            </section>
          )}

          {insight.answerGuidance && (
            <section className="si-sec">
              <div className="si-label">How to answer</div>
              <p className="si-text">{insight.answerGuidance}</p>
            </section>
          )}

          {insight.analysis && (
            <section className="si-sec">
              <button className="si-toggle" onClick={() => setShowFull((v) => !v)} aria-expanded={showFull}>
                <span className="si-caret">{showFull ? '▾' : '▸'}</span> Full breakdown
              </button>
              {showFull && <p className="si-text dim">{insight.analysis}</p>}
            </section>
          )}

          {points.length === 0 && !insight.answerGuidance && !insight.analysis && (
            <div className="si-error">No readable insight from that screen.</div>
          )}
        </div>
      )}
    </aside>
  );
}
