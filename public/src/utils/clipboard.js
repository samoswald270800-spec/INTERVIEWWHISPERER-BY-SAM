/**
 * Copy text to the clipboard in a way that survives the stealth overlay.
 *
 * The desktop window is always-on-top and content-protected, and it usually
 * does NOT hold OS/document focus. Chromium's async Clipboard API
 * (navigator.clipboard.writeText) requires a focused document, so in the
 * overlay it rejects with "Document is not focused" and silently does nothing —
 * which is why every Copy button appears dead in the desktop app.
 *
 * When the Electron bridge is present we route through the main process's
 * native clipboard, which has no focus requirement. In the browser (no bridge)
 * we use the standard API, with a legacy execCommand fallback.
 *
 * @param {string} text
 * @returns {Promise<boolean>} whether the copy succeeded
 */
export async function copyText(text) {
  const value = text == null ? '' : String(text);
  if (!value) return false;

  // 1) Electron native clipboard — works even when the overlay isn't focused.
  if (typeof window !== 'undefined' && window.electron && window.electron.copyText) {
    try {
      const ok = await window.electron.copyText(value);
      if (ok !== false) return true;
    } catch { /* fall through to the web paths */ }
  }

  // 2) Async Clipboard API (browser, or a focused window).
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch { /* fall through to the legacy path */ }

  // 3) Legacy execCommand fallback.
  try {
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export default copyText;
