/**
 * human-typer.js — a synthetic human-typing model.
 *
 * planHumanTyping(text) returns a timestamped sequence of synthetic keystroke
 * events that reproduce `text` the way a person actually types it — variable
 * speed, thinking pauses, nearby-key slips, missed/repeated characters,
 * delayed corrections, and rhythm that shifts with punctuation and code
 * structure. It does NOT touch a keyboard; a separate player consumes the
 * sequence. Keeping generation pure makes it inspectable and testable (you can
 * print the whole timeline) and lets the player stay a dumb executor.
 *
 * Every event is labelled `synthetic: true` and carries: the key sent, the
 * intended key, the event type, the delay before it, an absolute timestamp,
 * and (for corrections) what went wrong.
 *
 * Invariant: applying the events (type key / backspace) reproduces `text`
 * exactly — mistakes always net out to the correct output.
 */

// QWERTY neighbours — a slip lands on a physically adjacent key.
const QWERTY_NEIGHBORS = {
  a: 'sqwz', b: 'vghn', c: 'xdfv', d: 'sefcx', e: 'wrsdf', f: 'drtgcv',
  g: 'ftyhbv', h: 'gyujbn', i: 'ujko', j: 'huikmn', k: 'jiolm', l: 'kop',
  m: 'njk', n: 'bhjm', o: 'iklp', p: 'ol', q: 'wa', r: 'edft',
  s: 'awedxz', t: 'rfgy', u: 'yhji', v: 'cfgb', w: 'qase', x: 'zsdc',
  y: 'tghu', z: 'asx',
  0: '9', 1: '2', 2: '13', 3: '24', 4: '35', 5: '46', 6: '57', 7: '68', 8: '79', 9: '80',
};

// Muscle-memory tokens — typed faster, with a steadier rhythm.
const COMMON = new Set([
  'for', 'if', 'else', 'while', 'return', 'int', 'void', 'def', 'class', 'public',
  'private', 'const', 'let', 'var', 'function', 'true', 'false', 'null', 'new',
  'import', 'from', 'this', 'self', 'print', 'log', 'map', 'set', 'vector',
  'string', 'bool', 'the', 'and', 'with', 'in', 'is', 'to', 'of', 'end', 'begin',
  'size', 'push', 'back', 'auto', 'std', 'cout', 'main',
]);

// Common letter pairs — the hands flow through these from muscle memory.
const BIGRAMS = new Set([
  'th', 'he', 'in', 'er', 'an', 're', 'on', 'at', 'en', 'nd', 'ti', 'es', 'or',
  'te', 'of', 'ed', 'is', 'it', 'al', 'ar', 'st', 'to', 'nt', 'ng', 'se', 'ha',
  'as', 'ou', 'io', 'le', 've', 'co', 'me', 'de', 'hi', 'ri', 'ro', 'ic', 'ne',
  'ea', 'ra', 'ce', 'li', 'ch', 'll', 'be', 'ma', 'si', 'om', 'ur', 'ca', 'el',
  'ta', 'di', 'ns', 'tr', 'pr', 'nt', 'et', 'ec',
]);

// Type/declaration keywords — an identifier right after one of these is a
// freshly-invented name (function/variable), so the typist pauses to think.
const DECL_BEFORE_NAME = new Set([
  'def', 'function', 'class', 'int', 'void', 'bool', 'const', 'let', 'var',
  'string', 'vector', 'auto', 'static', 'public', 'private', 'struct', 'enum',
  'interface', 'type', 'float', 'double', 'long', 'char', 'unordered_set',
  'unordered_map', 'return',
]);

const CONDITION_WORDS = new Set(['if', 'while', 'for', 'switch', 'elif']);

// mulberry32 — small seedable RNG so tests are reproducible; production omits
// the seed and uses Math.random.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function tokenize(text) {
  const tokens = [];
  const re = /[A-Za-z_][A-Za-z0-9_]*|[0-9]+(?:\.[0-9]+)?|\n|\t| +|[^\sA-Za-z0-9_]/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const val = m[0];
    let type;
    if (val === '\n') type = 'newline';
    else if (val === '\t' || val[0] === ' ') type = 'space';
    else if (/^[A-Za-z_]/.test(val)) type = 'word';
    else if (/^[0-9]/.test(val)) type = 'number';
    else type = 'symbol';
    tokens.push({ val, start: m.index, type });
  }
  return tokens;
}

export function planHumanTyping(text, opts = {}) {
  const rng = opts.rng || (typeof opts.seed === 'number' ? mulberry32(opts.seed) : Math.random);
  const rand = (min, max) => min + rng() * (max - min);
  const chance = (p) => rng() < p;
  const pick = (s) => s[Math.floor(rng() * s.length)];
  // Overall pace: 1 = the model's natural (fastest) speed; >1 slows everything
  // down proportionally. The speed slider drives this (1 = "Max", up to ~5 =
  // "Slowest"). Every delay is multiplied by it.
  const paceScale = Math.max(0.5, Math.min(8, opts.paceScale || 1));

  const events = [];
  let t = 0;              // cumulative ms
  let buffer = '';        // simulated on-screen text (guards correctness)
  let speed = 1.0;        // slow-drifting rhythm factor
  let burstUntil = -1;    // source index up to which we're in a fast "flow" burst
  let cautiousUntil = -1; // source index up to which we type carefully (post-slip)
  const total = text.length || 1;

  // Whole-solution arc: warm up (slower), settle into flow (fastest), then a
  // touch of fatigue toward the end.
  const sessionPace = (idx) => {
    const p = idx / total;
    if (p < 0.22) return 1.16 - (p / 0.22) * 0.26;   // 1.16 → 0.90
    if (p < 0.70) return 0.90 + (p - 0.22) * 0.05;   // ~0.90 → 0.92
    return 0.92 + (p - 0.70) * 0.33;                 // 0.92 → ~1.02
  };

  const emit = (type, { key = '', intendedKey = '', delayMs = 0, reason = '', correction = null }) => {
    const d = Math.max(0, Math.round(delayMs * paceScale));
    t += d;
    events.push({
      i: events.length, synthetic: true, type,
      key, intendedKey, reason,
      delayMs: d, atMs: Math.round(t),
      correction,
    });
  };

  // A key that lands on screen (printable char, Enter for \n, Tab for \t).
  const keyEvent = (ch, delayMs, reason, intendedKey = ch, correction = null) => {
    emit('key', { key: ch, intendedKey, delayMs, reason, correction });
    buffer += ch;
  };
  const backspace = (delayMs, reason) => { emit('backspace', { key: 'Backspace', delayMs, reason }); buffer = buffer.slice(0, -1); };
  const pause = (delayMs, reason) => emit('pause', { delayMs, reason });

  // Per-character cadence, shaped by what's being typed and where we are.
  const charDelay = (ch, ctx = {}) => {
    const { fast = false, complex = false, firstOfWord = false, posInWord = 0, prevCh = '', srcIdx = 0 } = ctx;
    let base = fast ? rand(28, 66) : rand(52, 122);
    if (ch === ' ') base = rand(22, 64);                                     // thumb — quick, steady
    if (/[A-Z]/.test(ch)) base *= rand(1.1, 1.4);                            // reaching for shift
    if (/[0-9]/.test(ch)) base *= rand(1.1, 1.4);                            // number row
    if (/[{}()[\]<>;:=+\-*/%&|^!?~@#$]/.test(ch)) base *= rand(1.15, 1.75);  // symbols are fiddlier
    if (firstOfWord) base *= rand(1.05, 1.3);                               // starting a word
    else if (posInWord >= 2) base *= rand(0.82, 0.98);                      // momentum mid-word
    if (prevCh && BIGRAMS.has((prevCh + ch).toLowerCase())) base *= rand(0.78, 0.95); // familiar pair
    if (complex) base *= rand(1.3, 1.9);                                    // dense/complex code
    if (srcIdx <= burstUntil) base *= rand(0.6, 0.82);                      // in a flow burst
    if (srcIdx <= cautiousUntil) base *= rand(1.15, 1.45);                  // careful after a slip
    speed = Math.min(1.4, Math.max(0.72, speed + rand(-0.05, 0.05)));       // slow rhythm drift
    return base * speed * sessionPace(srcIdx);
  };

  const neighbor = (ch) => {
    const near = QWERTY_NEIGHBORS[ch.toLowerCase()];
    if (!near) return null;
    const p = pick(near);
    return ch === ch.toUpperCase() && ch !== ch.toLowerCase() ? p.toUpperCase() : p;
  };

  const tokens = tokenize(text);
  let prevWord = '';

  for (let ti = 0; ti < tokens.length; ti++) {
    const tok = tokens[ti];

    // ── token-level "thinking" pauses ──
    if (tok.type === 'newline') {
      keyEvent('\n', rand(120, 320), 'newline');
      // review / block pause after a line, longer at block ends
      const next = tokens[ti + 1];
      const blockEnd = next && next.type === 'symbol' && next.val === '}';
      if (blockEnd && chance(0.6)) pause(rand(350, 950), 'review-block');
      else if (chance(0.14)) pause(rand(300, 1000), 'review-line');
      continue;
    }
    if (tok.type === 'space') {
      for (const ch of tok.val) {
        if (ch === '\t') { keyEvent('\t', rand(40, 110), 'indent'); }
        else keyEvent(' ', charDelay(' '), 'space');
      }
      continue;
    }

    const isCommon = tok.type === 'word' && COMMON.has(tok.val);
    const isName = tok.type === 'word' && DECL_BEFORE_NAME.has(prevWord) && !COMMON.has(tok.val);
    const startsComment = tok.type === 'symbol' && (tok.val === '/' || tok.val === '#') &&
      (text.startsWith('//', tok.start) || text.startsWith('/*', tok.start) || tok.val === '#');
    const startsCondition = tok.type === 'symbol' && tok.val === '(' && CONDITION_WORDS.has(prevWord);
    const complex = tok.type === 'symbol' && /[<>{}[\]&|]/.test(tok.val);

    // longer pause before a freshly-named identifier / a condition / a comment
    if (isName) pause(rand(240, 720), 'think-name');
    else if (startsCondition) pause(rand(180, 560), 'think-condition');
    else if (startsComment) pause(rand(300, 820), 'think-comment');
    else if (tok.type === 'word' && !isCommon && tok.val.length > 6 && chance(0.4)) pause(rand(120, 380), 'think-word');

    // ── type the token's characters ──
    for (let k = 0; k < tok.val.length; k++) {
      const ch = tok.val[k];
      const srcIdx = tok.start + k;
      const prevCh = k > 0 ? tok.val[k - 1] : '';
      const firstOfWord = k === 0 && (tok.type === 'word' || tok.type === 'number');
      const eligible = /[A-Za-z0-9]/.test(ch); // only slip on letters/digits — keep structure intact
      const remainingInWord = tok.val.length - 1 - k;
      const ctx = { fast: isCommon, complex, firstOfWord, posInWord: k, prevCh, srcIdx };

      // occasional flow bursts, mid-typing freezes, and the rare distraction
      if (chance(0.02) && burstUntil < srcIdx) burstUntil = srcIdx + Math.floor(rand(4, 11));
      if (chance(0.012)) pause(rand(150, 430), 'micro-stall');
      if (chance(0.004)) pause(rand(1200, 3600), 'distraction');

      // decide a mistake (rarer inside common words)
      const mistakeP = eligible ? (isCommon ? 0.008 : 0.03) : 0;
      if (chance(mistakeP)) {
        cautiousUntil = srcIdx + Math.floor(rand(3, 9)); // rattled → careful for a bit
        const roll = rng();
        const nextCh = tok.val[k + 1];
        if (roll < 0.30) {
          // nearby-key slip, corrected immediately
          const wrong = neighbor(ch);
          if (wrong) {
            keyEvent(wrong, charDelay(ch, ctx), 'slip', ch, { kind: 'nearby-key', expected: ch, got: wrong });
            pause(rand(90, 300), 'notice-error');
            backspace(rand(70, 190), 'fix-slip');
            keyEvent(ch, rand(60, 150), 'retype', ch);
            continue;
          }
        } else if (roll < 0.44) {
          // repeated character
          keyEvent(ch, charDelay(ch, ctx), 'char', ch);
          keyEvent(ch, rand(45, 110), 'slip', '', { kind: 'repeat', expected: ch });
          pause(rand(110, 340), 'notice-error');
          backspace(rand(70, 200), 'fix-repeat');
          continue;
        } else if (roll < 0.58 && remainingInWord >= 1) {
          // missed character, noticed after typing 1–2 more, then inserted
          const k2 = remainingInWord >= 2 && chance(0.5) ? 2 : 1;
          const ahead = tok.val.slice(k + 1, k + 1 + k2);
          for (const c of ahead) keyEvent(c, charDelay(c, ctx), 'char', c);
          pause(rand(160, 520), 'notice-error');
          for (let b = 0; b < k2; b++) backspace(rand(60, 170), 'fix-missed');
          keyEvent(ch, rand(80, 220), 'insert-missed', ch, { kind: 'missed', expected: ch });
          for (const c of ahead) keyEvent(c, rand(45, 120), 'retype', c);
          k += k2;
          continue;
        } else if (roll < 0.70 && remainingInWord >= 1) {
          // nearby slip noticed one char late (delayed correction)
          const wrong = neighbor(ch);
          const aheadCh = tok.val[k + 1];
          if (wrong) {
            keyEvent(wrong, charDelay(ch, ctx), 'slip', ch, { kind: 'nearby-key-delayed', expected: ch, got: wrong });
            keyEvent(aheadCh, charDelay(aheadCh, ctx), 'char', aheadCh);
            pause(rand(140, 460), 'notice-error');
            backspace(rand(70, 180), 'fix-delayed');
            backspace(rand(55, 150), 'fix-delayed');
            keyEvent(ch, rand(70, 170), 'retype', ch);
            keyEvent(aheadCh, rand(50, 130), 'retype', aheadCh);
            k += 1;
            continue;
          }
        } else if (roll < 0.85 && nextCh && /[A-Za-z0-9]/.test(nextCh)) {
          // transposition — the two keys land in the wrong order ("teh" for "the")
          keyEvent(nextCh, charDelay(nextCh, ctx), 'slip', ch, { kind: 'transpose', expected: ch + nextCh, got: nextCh + ch });
          keyEvent(ch, rand(45, 110), 'slip', nextCh);
          pause(rand(120, 430), 'notice-error');
          backspace(rand(70, 180), 'fix-transpose');
          backspace(rand(55, 150), 'fix-transpose');
          keyEvent(ch, rand(70, 160), 'retype', ch);
          keyEvent(nextCh, rand(50, 120), 'retype', nextCh);
          k += 1;
          continue;
        } else {
          // case slip — wrong case, then fixed (missed / over-held shift)
          const other = ch === ch.toLowerCase() ? ch.toUpperCase() : ch.toLowerCase();
          if (other !== ch) {
            keyEvent(other, charDelay(ch, ctx), 'slip', ch, { kind: 'case', expected: ch, got: other });
            pause(rand(90, 300), 'notice-error');
            backspace(rand(70, 180), 'fix-case');
            keyEvent(ch, rand(60, 150), 'retype', ch);
            continue;
          }
        }
      }

      keyEvent(ch, charDelay(ch, ctx), 'char', ch);

      // structural settle: a beat inside a fresh bracket; a breath after a separator
      if (ch === '(' || ch === '{') { if (chance(0.22)) pause(rand(120, 480), 'bracket-content'); }
      else if (ch === ',' || ch === ';') { if (chance(0.28)) pause(rand(60, 240), 'settle'); }
    }

    if (tok.type === 'word' || tok.type === 'number') prevWord = tok.val;
    else if (tok.type === 'symbol') prevWord = ''; // reset so names are detected freshly
  }

  const totalMs = t;
  return {
    events,
    meta: {
      chars: text.length,
      events: events.length,
      corrections: events.filter((e) => e.correction).length,
      totalMs,
      wpm: text.length ? Math.round((text.length / 5) / (totalMs / 60000)) : 0,
    },
  };
}

/**
 * Replay an event sequence into the current on-screen text (no timing).
 * Used by tests to prove the sequence reproduces the source exactly.
 */
export function replayToText(events) {
  let buf = '';
  for (const e of events) {
    if (e.type === 'key') buf += e.key;
    else if (e.type === 'backspace') buf = buf.slice(0, -1);
    // 'pause'/'delete-forward' don't change end-of-caret text
  }
  return buf;
}

export default planHumanTyping;
