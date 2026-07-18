import { useEffect, useState, useCallback } from 'react';
import API_BASE_URL from '../config';
import './ProfilePage.css';

// Same four accents as login.html / index.css, with per-theme swatch colors.
const ACCENTS = [
  { key: 'violet', label: 'Violet', dark: '#8B7CF6', light: '#6D5AE6' },
  { key: 'cyan', label: 'Cyan', dark: '#22D3EE', light: '#0891B2' },
  { key: 'ember', label: 'Ember', dark: '#F5A97F', light: '#D96E30' },
  { key: 'mono', label: 'Mono', dark: '#ECECEA', light: '#141416' },
];

const monogram = (name) => (name || '?').slice(0, 2).toUpperCase();

const fmtLongDate = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d)) return null;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

const fmtShortDate = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

// Sessions carry no name in the DB, so give each a friendly auto-name derived
// from when it started (the date is shown separately on the right).
const sessionAutoName = (iso) => {
  const d = iso ? new Date(iso) : null;
  if (!d || isNaN(d)) return 'Interview session';
  const h = d.getHours();
  const period = h < 5 ? 'Late-night' : h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : h < 21 ? 'Evening' : 'Late-night';
  return `${period} interview`;
};

const fmtDuration = (secs) => {
  const s = Math.max(0, Math.round(secs || 0));
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
};

function Icon({ path, size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{path}</svg>
  );
}

export default function ProfilePage({ accent, theme, onAccentChange, onThemeChange, onSignOut, orgCode: orgCodeProp, showToast }) {
  const [me, setMe] = useState(null);
  const [creditInfo, setCreditInfo] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const opts = { credentials: 'include' };
    try {
      const [meRes, chRes, sesRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/user/me`, opts),
        fetch(`${API_BASE_URL}/api/user/credit-history`, opts),
        fetch(`${API_BASE_URL}/api/user/sessions`, opts),
      ]);
      if (meRes.status === 401) { window.location.href = '/login'; return; }
      const meData = await meRes.json().catch(() => ({}));
      if (meData?.user) setMe(meData.user);
      if (meData?.creditInfo) setCreditInfo(meData.creditInfo);
      const chData = await chRes.json().catch(() => ({}));
      if (Array.isArray(chData?.transactions)) setTransactions(chData.transactions);
      const sesData = await sesRes.json().catch(() => ({}));
      if (Array.isArray(sesData?.sessions)) setSessions(sesData.sessions);
    } catch (e) {
      console.error('[Profile] load failed', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const username = me?.username || '';
  const permissions = me?.permissions || {};
  const orgCode = me?.orgCode || orgCodeProp || null;
  const memberSince = fmtLongDate(me?.memberSince);
  const credits = me?.credits ?? 0;
  const adminName = me?.adminName || 'your admin';

  const permRows = [
    { key: 'canExpand', title: 'Expand answers', desc: 'Longer, more detailed responses', on: !!permissions.canExpand },
    { key: 'canAnalyze', title: 'Screen analysis', desc: 'Analyze shared screens · 1 credit each', on: !!permissions.canAnalyze },
    { key: 'canTurbo', title: 'Turbo engine', desc: 'Premium engine tier', on: !!permissions.canTurbo },
  ];

  return (
    <div className="profile-scroll">
      <div className="profile-col">

        {/* Identity row */}
        <div className="profile-identity">
          <div className="profile-mono-tile">{monogram(username)}</div>
          <div className="profile-id-block">
            <div className="profile-name-line">
              <span className={'profile-username' + (loading ? ' sk sk-text' : '')}>{username || ' '}</span>
              <span className="profile-chip">Candidate</span>
              {orgCode && <span className="profile-chip mono">ORG · {orgCode}</span>}
              <span className="profile-chip status"><span className="dot" />Active</span>
            </div>
            <div className="profile-subline">
              Managed by {adminName}{memberSince ? ` · Member since ${memberSince}` : ''}
            </div>
          </div>
          <span className="profile-spacer" />
          <button className="iw-ghost-btn" onClick={() => showToast?.('Contact your administrator to change your password.')}>
            Change password
          </button>
          <button className="profile-signout-btn" onClick={onSignOut}>
            <Icon size={14} path={<><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></>} />
            Sign out
          </button>
        </div>

        {/* Two-column grid */}
        <div className="profile-grid">
          {/* Left column */}
          <div className="profile-grid-col">

            {/* Appearance */}
            <section className="profile-card">
              <div className="iw-eyebrow">Appearance</div>
              <div className="profile-appearance-row">
                <span className="profile-row-label">Accent</span>
                <span className="profile-accent-name">{accent}</span>
              </div>
              <div className="profile-swatches">
                {ACCENTS.map((a) => (
                  <button
                    key={a.key}
                    className={'profile-swatch' + (a.key === accent ? ' active' : '')}
                    style={{ '--sw': theme === 'light' ? a.light : a.dark }}
                    title={a.label}
                    aria-label={`${a.label} accent`}
                    aria-pressed={a.key === accent}
                    onClick={() => onAccentChange?.(a.key)}
                  />
                ))}
              </div>
              <div className="profile-appearance-row" style={{ marginTop: '16px' }}>
                <span className="profile-row-label">Theme</span>
                <div className="profile-theme-pills">
                  <button className={'profile-theme-pill' + (theme === 'dark' ? ' active' : '')} onClick={() => onThemeChange?.('dark')}>Dark</button>
                  <button className={'profile-theme-pill' + (theme === 'light' ? ' active' : '')} onClick={() => onThemeChange?.('light')}>Light</button>
                </div>
              </div>
              <div className="profile-footnote">Applies across the whole app and is remembered on this device.</div>
            </section>

            {/* Permissions */}
            <section className="profile-card">
              <div className="iw-eyebrow">Permissions</div>
              <div className="profile-perm-list">
                {permRows.map((r) => (
                  <div className="profile-perm-row" key={r.key}>
                    <div>
                      <div className="profile-perm-title">{r.title}</div>
                      <div className="profile-perm-desc">{r.desc}</div>
                    </div>
                    <span className={'profile-perm-status' + (r.on ? ' on' : '')}>{r.on ? 'Enabled' : 'Locked'}</span>
                  </div>
                ))}
              </div>
              <div className="profile-footnote">Set by your consultancy admin.</div>
            </section>
          </div>

          {/* Right column */}
          <div className="profile-grid-col">

            {/* Credits */}
            <section className="profile-card wide">
              <div className="profile-credits-top">
                <div className="profile-credits-figure">
                  <div className={'profile-credits-num' + (loading ? ' sk sk-num' : '')}>{loading ? '' : `${credits} min`}</div>
                  <div className="iw-eyebrow">Credits balance</div>
                </div>
                <div className="profile-vdivider" />
                <div className="profile-credits-info">
                  <div>Session minimum · {creditInfo?.minSessionCost ?? '—'} min</div>
                  <div>Screen analysis · {creditInfo?.screenAnalysisCost ?? '—'} credit</div>
                </div>
                <span className="profile-spacer" />
                <div className="profile-credits-note">Top-ups are handled by {adminName}</div>
                <button className="iw-primary-btn profile-topup" onClick={() => showToast?.(`Request sent to ${adminName}`)}>
                  Request top-up
                </button>
              </div>
            </section>

            {/* Credit history */}
            <section className="profile-card wide">
              <div className="profile-card-head">
                <div className="iw-eyebrow">Credit history</div>
                <span className="profile-head-note">Last 30 days</span>
              </div>
              <div className="profile-list">
                {loading && <div className="profile-empty">Loading…</div>}
                {!loading && transactions.length === 0 && <div className="profile-empty">No credit activity yet.</div>}
                {transactions.slice(0, 10).map((t, i) => {
                  const amt = Number(t.amount) || 0;
                  const pos = amt > 0;
                  return (
                    <div className="profile-tx-row" key={t.id || i}>
                      <span className={'profile-tx-amt' + (pos ? ' pos' : '')}>{pos ? '+' : '−'}{Math.abs(amt)} min</span>
                      <span className="profile-tx-label">{t.description || 'Adjustment'}</span>
                      <span className="profile-spacer" />
                      <span className="profile-tx-date">{fmtShortDate(t.created_at)}</span>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Session history */}
            <section className="profile-card wide">
              <div className="profile-card-head">
                <div className="iw-eyebrow">Session history</div>
              </div>
              <div className="profile-list">
                {loading && <div className="profile-empty">Loading…</div>}
                {!loading && sessions.length === 0 && <div className="profile-empty">No sessions yet.</div>}
                {sessions.slice(0, 10).map((s, i) => {
                  const turbo = Number(s.credit_multiplier) > 1;
                  return (
                    <div className="profile-ses-row" key={s.id || i}>
                      <span className="profile-ses-name">{sessionAutoName(s.start_time)}</span>
                      <span className={'profile-engine-chip' + (turbo ? ' turbo' : ' live')}>{turbo ? 'Turbo' : 'Live'}</span>
                      <span className="profile-spacer" />
                      <span className="profile-ses-dur">{fmtDuration(s.total_seconds)}</span>
                      <span className="profile-ses-date">{fmtShortDate(s.start_time)}</span>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
