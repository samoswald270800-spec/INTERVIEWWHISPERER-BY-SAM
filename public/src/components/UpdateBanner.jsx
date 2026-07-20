import './UpdateBanner.css';

/**
 * UpdateBanner — a soft, dismissible "a new version is available" nudge.
 *
 * Presentational only. App.jsx decides whether to render it (desktop app +
 * outdated version + not mid-interview), shows it once per login, and handles
 * "Update" / "Continue anyway". Dismissing changes nothing else about the app.
 */
export default function UpdateBanner({ onUpdate, onDismiss, canUpdate }) {
  return (
    <div className="update-banner" role="status" aria-live="polite">
      <span className="ub-icon" aria-hidden="true">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 19V5" /><path d="M5 12l7-7 7 7" />
        </svg>
      </span>
      <span className="ub-text">
        <strong>A new version is available.</strong> Update for the latest features.
      </span>
      <span className="ub-actions">
        <button className="ub-btn ub-ghost" onClick={onDismiss}>Continue anyway</button>
        {canUpdate && (
          <button className="ub-btn ub-primary" onClick={onUpdate}>Update</button>
        )}
      </span>
    </div>
  );
}
