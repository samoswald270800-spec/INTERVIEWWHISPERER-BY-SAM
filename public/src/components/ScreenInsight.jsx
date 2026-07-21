import { useEffect, useRef, useState } from 'react';
import { copyText } from '../utils/clipboard';
import './ScreenInsight.css';

const TYPE_LABEL = {
  code: 'Code',
  sql: 'SQL',
  chart: 'Graph',
  system_design: 'System design',
  mcq: 'Multiple choice',
  data_table: 'Data',
  error: 'Error',
  math: 'Math',
  document: 'Document',
  ui_design: 'UI',
  other: 'Insight',
};

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
  const [codeCopied, setCodeCopied] = useState(false);
  // "Type it in": idle → countdown (focus your editor first) → typing.
  const [typeState, setTypeState] = useState('idle');
  const [typeCount, setTypeCount] = useState(0);
  const countdownRef = useRef(null);
  // Typing speed: 0 = slowest human pace, 1 = max (the model's natural speed).
  // Defaults slow, and remembers your choice.
  const [typeSpeed, setTypeSpeed] = useState(() => {
    try { const v = parseFloat(localStorage.getItem('iw_type_speed')); return isNaN(v) ? 0.3 : Math.max(0, Math.min(1, v)); }
    catch { return 0.3; }
  });
  const changeSpeed = (v) => {
    setTypeSpeed(v);
    try { localStorage.setItem('iw_type_speed', String(v)); } catch { /* ignore */ }
  };
  // Clear the editor (select-all + delete) before typing, so the solution
  // never nests inside the site's pre-filled stub. On by default.
  const [clearFirst, setClearFirst] = useState(() => {
    try { return localStorage.getItem('iw_type_clear') !== '0'; } catch { return true; }
  });
  const toggleClear = () => setClearFirst((v) => {
    const nv = !v;
    try { localStorage.setItem('iw_type_clear', nv ? '1' : '0'); } catch { /* ignore */ }
    return nv;
  });

  // Clear any pending focus countdown if the panel unmounts mid-way.
  useEffect(() => () => {
    if (countdownRef.current) clearInterval(countdownRef.current);
  }, []);

  if (!loading && !insight) return null;

  // key_points comes back as a newline / bullet string — normalize to items.
  const points = (insight?.keyPoints || '')
    .split(/\r?\n+/)
    .map((s) => s.replace(/^\s*(?:[•\-*•]|\d+[.)])\s*/, '').trim())
    .filter(Boolean);

  // First-person, read-aloud answer (falls back to the older guidance field
  // so responses from before this change still render).
  const say = insight?.spokenAnswer || insight?.answerGuidance || '';
  const code = insight?.code || '';
  const codeLang = insight?.codeLang || '';
  const typeLabel = insight && !insight.error ? (TYPE_LABEL[insight.type] || 'Insight') : '';

  // "Type it in" is a desktop-app power move — it drives the real keyboard, so
  // it only appears when the Electron bridge is present and there's code.
  const canType = typeof window !== 'undefined' && !!window.electron?.typeCode && !!code;

  const copyCode = () => {
    if (!code) return;
    copyText(code).then((ok) => {
      if (!ok) return;
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 1400);
    });
  };

  // Count down first so the candidate can click into their real editor — the
  // keystrokes go to whatever window has focus, not this overlay.
  const beginTypeIn = () => {
    if (!canType || typeState !== 'idle') return;
    let n = 3;
    setTypeCount(n);
    setTypeState('countdown');
    countdownRef.current = setInterval(() => {
      n -= 1;
      if (n > 0) { setTypeCount(n); return; }
      clearInterval(countdownRef.current);
      countdownRef.current = null;
      setTypeState('typing');
      window.electron.typeCode(code, typeSpeed, clearFirst).finally(() => setTypeState('idle'));
    }, 1000);
  };

  const stopTypeIn = () => {
    if (typeState === 'countdown') {
      if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
      setTypeState('idle');
    } else if (typeState === 'typing') {
      window.electron?.cancelTypeCode?.();
    }
  };

  const copyAll = () => {
    const text = [
      say ? 'SAY THIS\n' + say : '',
      points.length ? 'KEY POINTS\n' + points.map((p) => '• ' + p).join('\n') : '',
    ].filter(Boolean).join('\n\n');
    if (!text) return;
    copyText(text).then((ok) => {
      if (!ok) return;
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    });
  };

  return (
    <aside className="screen-insight" aria-label="Screen insight">
      <div className="si-head">
        <span className="si-dot" />
        <span className="iw-eyebrow">Screen insight</span>
        {typeLabel && !loading && (
          <span className="si-type">{typeLabel}{codeLang ? ' · ' + codeLang : ''}</span>
        )}
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
          {code && (
            <section className="si-sec">
              <div className="si-code-head">
                <span className="si-label">Code to type</span>
                <div className="si-code-actions">
                  <button className="si-copycode" onClick={copyCode}>{codeCopied ? 'Copied' : 'Copy'}</button>
                  {canType && (
                    <button
                      className={'si-typein' + (typeState !== 'idle' ? ' active' : '')}
                      onClick={typeState === 'idle' ? beginTypeIn : stopTypeIn}
                    >
                      {typeState === 'idle' && (<><span className="si-kbd">⌨</span> Type it in</>)}
                      {typeState === 'countdown' && `Focus editor… ${typeCount}`}
                      {typeState === 'typing' && 'Stop'}
                    </button>
                  )}
                </div>
              </div>
              {canType && typeState === 'idle' && (
                <div className="si-speed">
                  <span className="si-speed-label">Typing speed</span>
                  <span className="si-speed-end">Slowest</span>
                  <input
                    className="si-speed-range"
                    type="range" min="0" max="1" step="0.05"
                    value={typeSpeed}
                    onChange={(e) => changeSpeed(parseFloat(e.target.value))}
                    aria-label="Typing speed"
                  />
                  <span className="si-speed-end">Max</span>
                </div>
              )}
              {canType && typeState === 'idle' && (
                <label className="si-clear">
                  <input type="checkbox" checked={clearFirst} onChange={toggleClear} />
                  <span className="si-clear-box" aria-hidden="true" />
                  <span className="si-clear-text">Clear editor first</span>
                </label>
              )}
              {typeState === 'countdown' && (
                <p className="si-typein-hint">Click into your code editor — typing starts in {typeCount}…</p>
              )}
              {typeState === 'typing' && (
                <p className="si-typein-hint">Typing into your editor… click Stop to halt.</p>
              )}
              <pre className="si-code"><code>{code}</code></pre>
            </section>
          )}

          {say && (
            <section className="si-sec">
              <div className="si-label">Say this</div>
              <p className="si-text si-say">{say}</p>
            </section>
          )}

          {points.length > 0 && (
            <section className="si-sec">
              <div className="si-label">Key points</div>
              <ul className="si-points">
                {points.map((p, i) => <li key={i}>{p}</li>)}
              </ul>
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

          {!say && !code && points.length === 0 && !insight.analysis && (
            <div className="si-error">No readable insight from that screen.</div>
          )}
        </div>
      )}
    </aside>
  );
}
