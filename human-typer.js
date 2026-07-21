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

  const events = [];
  let t = 0;              // cumulative ms
  let buffer = '';        // simulated on-screen text (guards correctness)
  let speed = 1.0;        // slow-drifting rhythm factor

  const emit = (type, { key = '', intendedKey = '', delayMs = 0, reason = '', correction = null }) => {
    t += Math.max(0, Math.round(delayMs));
    events.push({
      i: events.length, synthetic: true, type,
      key, intendedKey, reason,
      delayMs: Math.max(0, Math.round(delayMs)), atMs: Math.round(t),
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

  // Per-character cadence, shaped by what's being typed.
  const charDelay = (ch, { fast = false, complex = false, firstOfWord = false } = {}) => {
    let base = fast ? rand(28, 70) : rand(55, 130);
    if (ch === ' ') base = rand(24, 70);
    if (/[{}()[\]<>;:=+\-*/%&|^!?]/.test(ch)) base *= rand(1.15, 1.7); // symbols are fiddlier
    if (firstOfWord) base *= rand(1.0, 1.25);
    if (complex) base *= rand(1.3, 1.9);                                // dense/complex code
    // drift the overall rhythm a little each keystroke
    speed = Math.min(1.45, Math.max(0.7, speed + rand(-0.06, 0.06)));
    return base * speed;
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
      const firstOfWord = k === 0 && (tok.type === 'word' || tok.type === 'number');
      const eligible = /[A-Za-z0-9]/.test(ch); // only slip on letters/digits — keep structure intact
      const remainingInWord = tok.val.length - 1 - k;

      // decide a mistake (rarer inside common words)
      const mistakeP = eligible ? (isCommon ? 0.008 : 0.03) : 0;
      if (chance(mistakeP)) {
        const roll = rng();
        if (roll < 0.5) {
          // nearby-key slip, corrected immediately
          const wrong = neighbor(ch);
          if (wrong) {
            keyEvent(wrong, charDelay(ch, { fast: isCommon }), 'slip', ch,
              { kind: 'nearby-key', expected: ch, got: wrong });
            pause(rand(90, 300), 'notice-error');
            backspace(rand(70, 190), 'fix-slip');
            keyEvent(ch, rand(60, 150), 'retype', ch);
            continue;
          }
        } else if (roll < 0.68) {
          // repeated character
          keyEvent(ch, charDelay(ch, { fast: isCommon, firstOfWord }), 'char', ch);
          keyEvent(ch, rand(45, 110), 'slip', '', { kind: 'repeat', expected: ch });
          pause(rand(110, 340), 'notice-error');
          backspace(rand(70, 200), 'fix-repeat');
          continue;
        } else if (roll < 0.84 && remainingInWord >= 1) {
          // missed character, noticed after typing 1–2 more, then inserted
          const k2 = remainingInWord >= 2 && chance(0.5) ? 2 : 1;
          const ahead = tok.val.slice(k + 1, k + 1 + k2);
          for (const c of ahead) keyEvent(c, charDelay(c, { fast: isCommon }), 'char', c);
          pause(rand(160, 520), 'notice-error');
          for (let b = 0; b < k2; b++) backspace(rand(60, 170), 'fix-missed');
          keyEvent(ch, rand(80, 220), 'insert-missed', ch, { kind: 'missed', expected: ch });
          for (const c of ahead) keyEvent(c, rand(45, 120), 'retype', c);
          k += k2;
          continue;
        } else if (remainingInWord >= 1) {
          // nearby slip noticed one char late (delayed correction)
          const wrong = neighbor(ch);
          const aheadCh = tok.val[k + 1];
          if (wrong) {
            keyEvent(wrong, charDelay(ch, { fast: isCommon }), 'slip', ch,
              { kind: 'nearby-key-delayed', expected: ch, got: wrong });
            keyEvent(aheadCh, charDelay(aheadCh), 'char', aheadCh);
            pause(rand(140, 460), 'notice-error');
            backspace(rand(70, 180), 'fix-delayed');
            backspace(rand(55, 150), 'fix-delayed');
            keyEvent(ch, rand(70, 170), 'retype', ch);
            keyEvent(aheadCh, rand(50, 130), 'retype', aheadCh);
            k += 1;
            continue;
          }
        }
      }

      keyEvent(ch, charDelay(ch, { fast: isCommon, complex, firstOfWord }), 'char', ch);
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
