/**
 * Interview Routes
 * Main interview functionality: realtime session, JD, screen analysis
 */

import express from 'express';
import fetch from 'node-fetch';
import OpenAI from 'openai';
import multer from 'multer';
import FormData from 'form-data';
import { createAnthropic } from '@ai-sdk/anthropic';
import { generateText } from 'ai';
import config from '../config/index.js';
import promptConfig from '../utils/prompts.js';
import * as cheerio from 'cheerio';

// Setup multer for in-memory audio buffer parsing
const upload = multer({ storage: multer.memoryStorage() });
import { requireAuth } from '../middleware/auth.js';
import { checkAnalyzeRateLimit } from '../middleware/rateLimit.js';
import { getTranscript, storeTranscript, storeScreenAnalysis } from '../lib/redis.js';
import { buildInterviewInstructions, VISION_PROMPT } from '../utils/prompts.js';
import { startSession, endSession, getActiveSession, chargeScreenAnalysis } from '../services/credits.js';
import { resolveUserPermissions, resolveAdminPermissions } from '../services/permissions.js';
import { sanitizeText } from '../utils/sanitize.js';

const router = express.Router();

// OpenAI client
const openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });

// Retrieve pool of OpenAI API keys
const getOpenAIKeyPool = () => {
  const keys = [config.OPENAI_API_KEY]; // Existing key is always first

  // Add fallback keys if they exist in the environment
  if (process.env.OPENAI_API_KEY_1) keys.push(process.env.OPENAI_API_KEY_1);
  if (process.env.OPENAI_API_KEY_2) keys.push(process.env.OPENAI_API_KEY_2);

  return keys;
};

// Anthropic client
const anthropic = createAnthropic({
  apiKey: config.ANTHROPIC_API_KEY,
});

// In-memory storage for resume and assignment (shared, loaded from files)
let resume = '';
let assignment = '';

/**
 * Load resume and assignment from files
 */
export function loadDocuments(resumeText, assignmentText) {
  resume = resumeText || '';
  assignment = assignmentText || '';
}

export function getResume() { return resume; }
export function getAssignment() { return assignment; }
export function getJobDescription(req) { return (req?.session?.jobDescription) || ''; }

/**
 * POST /set-jd - Update Job Description
 */
router.post('/set-jd', (req, res) => {
  const rawJd = (req.body?.jd || '').toString();
  // Sanitize input: Strip HTML/Scripts and enforce length
  const sanitizedJd = sanitizeText(rawJd, 20000);
  // Store per-session so each user has their own JD
  if (req.session) req.session.jobDescription = sanitizedJd;
  return res.json({ ok: true, length: sanitizedJd.length });
});

/**
 * GET /get-jd - Retrieve stored Job Description
 */
router.get('/get-jd', (req, res) => {
  const jd = req.session?.jobDescription || '';
  return res.json({ ok: true, jd });
});

async function searchDuckDuckGo(query) {
  const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9'
    }
  });
  if (!response.ok) throw new Error(`DuckDuckGo responded with status: ${response.status}`);
  const html = await response.text();
  const $ = cheerio.load(html);
  const snippets = [];
  $('.result__snippet').each((i, el) => {
    if (i < 3) snippets.push(`[DuckDuckGo Result ${i + 1}]: ${$(el).text().trim()}`);
  });
  return snippets;
}

async function searchBing(query) {
  const response = await fetch(`https://www.bing.com/search?q=${encodeURIComponent(query)}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9'
    }
  });
  if (!response.ok) throw new Error(`Bing responded with status: ${response.status}`);
  const html = await response.text();
  const $ = cheerio.load(html);
  const snippets = [];
  $('.b_algo .b_caption p').each((i, el) => {
    if (i < 3) snippets.push(`[Bing Result ${i + 1}]: ${$(el).text().trim()}`);
  });
  return snippets;
}

async function searchWikipedia(query) {
  const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&utf8=&format=json`;
  const response = await fetch(searchUrl);
  if (!response.ok) throw new Error(`Wikipedia responded with status: ${response.status}`);
  const data = await response.json();
  const snippets = [];
  if (data.query && data.query.search) {
    data.query.search.slice(0, 3).forEach((item, i) => {
      const cleanSnippet = item.snippet.replace(/<[^>]*>?/gm, '');
      snippets.push(`[Wikipedia Result ${i + 1}] Title: ${item.title} - ${cleanSnippet}`);
    });
  }
  return snippets;
}

/**
 * POST /api/search - Web Search with Tri-Level Fallback
 */
router.post('/api/search', requireAuth, async (req, res) => {
  try {
    const { query } = req.body || {};
    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: 'Query is required.' });
    }

    console.log(`[Search] Searching web for: "${query}"`);
    let snippets = [];

    // 1. DuckDuckGo (Primary)
    try {
      snippets = await searchDuckDuckGo(query);
    } catch (e) {
      console.warn(`[Search] DuckDuckGo failed: ${e.message}`);
    }

    // 2. Bing (Secondary Fallback)
    if (snippets.length === 0) {
      try {
        console.log(`[Search] Falling back to Bing for: "${query}"`);
        snippets = await searchBing(query);
      } catch (e) {
        console.warn(`[Search] Bing failed: ${e.message}`);
      }
    }

    // 3. Wikipedia API (Ultimate Failsafe)
    if (snippets.length === 0) {
      try {
        console.log(`[Search] Falling back to Wikipedia for: "${query}"`);
        snippets = await searchWikipedia(query);
      } catch (e) {
        console.warn(`[Search] Wikipedia failed: ${e.message}`);
      }
    }

    if (snippets.length === 0) {
      return res.json({ results: 'No recent or relevant search results found across all providers.' });
    }

    const combinedResults = snippets.join('\n\n');
    console.log(`[Search] Found ${snippets.length} snippets. Returning top results.`);

    return res.json({ results: combinedResults });
  } catch (err) {
    console.error('[Search] Error:', err);
    return res.status(500).json({ error: 'Internal search error.' });
  }
});

/**
 * POST /session - Create OpenAI Realtime session
 */
router.post('/session', requireAuth, async (req, res) => {
  try {
    const mode = (req.body?.mode || 'smart').toString().toLowerCase();
    const interviewMode = (req.body?.interviewMode || 'smart').toString().toLowerCase();
    const architecture = (req.body?.architecture || 'live').toString().toLowerCase();
    const supabase = req.app.locals.supabase;

    // Select model and credit rate based on architecture
    // gpt-realtime = standard, gpt-realtime-2 = GPT-5 class reasoning (Turbo)
    const isTurbo = architecture === 'turbo';
    const realtimeModel = isTurbo ? 'gpt-realtime-2' : 'gpt-realtime';
    const creditMultiplier = isTurbo ? 2 : 1;

    console.log('→ Creating realtime session with mode:', mode, 'interview mode:', interviewMode, 'architecture:', architecture, 'model:', realtimeModel);

    // For users AND admins: check credits and create session record
    const role = req.session.role;
    const accountId = req.session.supabaseId;

    // Server-side permission enforcement (cannot be bypassed by a stale/modified
    // frontend). Super admin is excluded from this block entirely, so it is never
    // gated. We resolve the effective permissions once and enforce both the
    // "can start a session at all" flag and the architecture-specific flag.
    if (supabase && accountId && (role === 'user' || role === 'admin')) {
      let resolved;
      if (role === 'user') {
        const { data: userData } = await supabase.from('users').select('permissions, admin_id').eq('id', accountId).single();
        let adminPerms = {};
        if (userData?.admin_id) {
          const { data: adminData } = await supabase.from('admins').select('permissions').eq('id', userData.admin_id).single();
          adminPerms = adminData?.permissions || {};
        }
        resolved = resolveUserPermissions(userData?.permissions || {}, adminPerms);
      } else {
        const { data: adminData } = await supabase.from('admins').select('permissions').eq('id', accountId).single();
        resolved = resolveAdminPermissions(adminData?.permissions || {});
      }

      // Gate 1: starting any interview session at all (Live/Turbo/Reasoning).
      if (resolved.permissions.canStartSession === false) {
        console.log(`[Session] Blocked: ${role} ${accountId} lacks canStartSession`);
        return res.status(403).json({ error: 'Starting interview sessions is disabled for your account.', code: 'FEATURE_LOCKED' });
      }

      // Gate 2: architecture-specific flag (Turbo / Reasoning).
      const permKey = isTurbo ? 'canTurbo' : (architecture === 'reasoning' ? 'canReasoning' : null);
      if (permKey && resolved.permissions[permKey] === false) {
        console.log(`[Session] Blocked: ${role} ${accountId} lacks ${permKey} permission`);
        return res.status(403).json({ error: `${architecture} mode is not available for your account.`, code: 'FEATURE_LOCKED' });
      }
    }

    if (supabase && accountId && (role === 'user' || role === 'admin')) {
      // Check if there's already an active session (prevent duplicate charges)
      const existingSession = await getActiveSession(supabase, accountId, role);
      if (existingSession) {
        console.log(`[Session] ${role} ${accountId} has active session ${existingSession.id}, reusing`);
        req.session.activeSessionId = existingSession.id;
      } else {
        const ownerId = role === 'user' ? req.session.adminId : accountId;

        // Start new session (checks credits and creates record)
        const sessionResult = await startSession(supabase, accountId, ownerId, role, creditMultiplier);

        if (!sessionResult.success) {
          console.log(`[Session] Credit check failed for ${req.session.userId}: ${sessionResult.error}`);
          return res.status(402).json({
            error: sessionResult.error,
            code: 'INSUFFICIENT_CREDITS'
          });
        }
        req.session.activeSessionId = sessionResult.session.id;
        console.log(`[Session] Created session ${sessionResult.session.id} for ${role} ${req.session.userId}`);
      }


      // Save session to persist activeSessionId
      await new Promise((resolve, reject) => {
        req.session.save((err) => err ? reject(err) : resolve());
      });
    }

    const screenAnalysisContext = req.session?.screenAnalysisContext || '';

    const fullInstructions = buildInterviewInstructions({
      interviewMode,
      resume: '',
      assignment: '',
      jobDescription: getJobDescription(req),  // Read stored JD from session
      screenAnalysisContext,
    });

    if (req.session) req.session.mode = mode;

    // 3. Request OpenAI ephemeral key with key pool fallback
    const keys = getOpenAIKeyPool();
    let session = null;
    let lastError = null;

    // Retry loop for API Key Fallback
    for (let i = 0; i < keys.length; i++) {
      const apiKey = keys[i];
      console.log(`[Session] Attempting OpenAI Realtime Session with Key #${i === 0 ? 'Primary' : i}`);

      try {
        // All GA models use the /client_secrets endpoint.
        // The old /sessions beta endpoint (used by gpt-realtime-1.5) has been retired by OpenAI.
        const sessionEndpoint = 'https://api.openai.com/v1/realtime/client_secrets';

        // GA /client_secrets body: wrap config inside a `session` object
        const requestBody = {
          session: {
            type: 'realtime',
            model: realtimeModel,
            output_modalities: ['text'],
            instructions: fullInstructions,
            audio: {
              input: {
                transcription: {
                  model: 'gpt-4o-transcribe',
                  // Pin transcription to English. Without this, the model
                  // auto-detects the language and — on compressed/accented/noisy
                  // interview audio — frequently flips to a random language and
                  // emits gibberish. The interview is English-only.
                  language: 'en',
                },
                turn_detection: {
                  type: 'server_vad',
                  threshold: 0.5,
                  prefix_padding_ms: 300,
                  silence_duration_ms: 1200,
                  create_response: true,
                  interrupt_response: true,
                },
              },
            },
          }
        };

        const r = await fetch(sessionEndpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        });

        if (!r.ok) {
          const errData = await r.json().catch(() => ({}));
          throw new Error(`OpenAI HTTP ${r.status}: ${JSON.stringify(errData)}`);
        }

        session = await r.json();
        console.log(`[Session] ✅ Model confirmed by OpenAI: ${session.model || session.session?.model}`);

        // CRITICAL: Normalize response shape
        // /client_secrets returns: { value: "ek_...", expires_at: "...", session: { model, id, ... } }
        // Frontend expects: { client_secret: { value: "ek_..." }, model: "...", id: "...", ... }
        if (session.value && session.session) {
          const ephemeralKey = session.value;
          const sessionConfig = session.session;
          session = {
            ...sessionConfig,
            client_secret: { value: ephemeralKey },
          };
        }
        break; // Success! Exit the retry loop
      } catch (err) {
        console.warn(`[Session] Key #${i === 0 ? 'Primary' : i} failed:`, err.message);
        lastError = err;
        // The loop will automatically continue to the next key
      }
    }

    if (!session) {
      console.error('[Session] All OpenAI API keys in the pool failed.');
      return res.status(502).json({ error: 'All AI models are currently overwhelmed or out of quota. Please contact support.', details: String(lastError) });
    }

    res.json(session);
  } catch (e) {
    console.error('Session error:', e);
    res.status(500).json({ error: String(e) });
  }
});

/**
 * POST /session/end - End active session and calculate credits
 */
router.post('/session/end', requireAuth, async (req, res) => {
  try {
    const supabase = req.app.locals.supabase;
    if (!supabase) {
      return res.status(503).json({ error: 'Database not configured' });
    }

    const userId = req.session.supabaseId;
    // Pass the role so admin sessions (stored under a placeholder user) are
    // found and closed. Without the role this defaulted to 'user' and admin
    // sessions could never be ended — leaving them stuck open (billed once,
    // then reused for free).
    const activeSession = await getActiveSession(supabase, userId, req.session.role);

    if (!activeSession) {
      return res.json({ ok: true, message: 'No active session to end' });
    }

    const result = await endSession(supabase, activeSession.id);
    if (!result.success) {
      return res.status(500).json({ error: result.error });
    }

    console.log(`→ Session ${activeSession.id} ended. Credits used: ${result.creditsUsed}`);
    return res.json({ ok: true, creditsUsed: result.creditsUsed });
  } catch (e) {
    console.error('Session end error:', e);
    return res.status(500).json({ error: 'Failed to end session' });
  }
});

/**
 * POST /session/expand-authorize
 * Server-side permission gate for the Live/Turbo "Expand" action. In those
 * modes the Expand itself happens browser↔OpenAI directly (no server round
 * trip), so the app must pass this check first. The decision is resolved fresh
 * from the DB, so it cannot be bypassed by a stale/edited frontend permission
 * flag. Super admin is always allowed.
 */
router.post('/session/expand-authorize', requireAuth, async (req, res) => {
  try {
    const supabase = req.app.locals.supabase;
    const role = req.session.role;
    const accountId = req.session.supabaseId;

    // Super admin (and any non-DB-backed session) is exempt.
    if (role === 'super_admin' || !supabase || !accountId || (role !== 'user' && role !== 'admin')) {
      return res.json({ allowed: true });
    }

    let resolved;
    if (role === 'user') {
      const { data: userData } = await supabase.from('users').select('permissions, admin_id').eq('id', accountId).single();
      let adminPerms = {};
      if (userData?.admin_id) {
        const { data: adminData } = await supabase.from('admins').select('permissions').eq('id', userData.admin_id).single();
        adminPerms = adminData?.permissions || {};
      }
      resolved = resolveUserPermissions(userData?.permissions || {}, adminPerms);
    } else {
      const { data: adminData } = await supabase.from('admins').select('permissions').eq('id', accountId).single();
      resolved = resolveAdminPermissions(adminData?.permissions || {});
    }

    if (resolved.permissions.canExpand === false) {
      return res.status(403).json({ allowed: false, error: 'Expand is disabled for your account.', code: 'FEATURE_LOCKED' });
    }
    return res.json({ allowed: true });
  } catch (e) {
    // Fail-open: a DB hiccup shouldn't break a paid, in-progress session. The
    // UI gate still applies; this endpoint is the extra server-side backstop.
    console.warn('[Expand Authorize] check failed, allowing:', e?.message);
    return res.json({ allowed: true });
  }
});

/**
 * POST /analyze-screen - Analyze screenshot with AI
 */
router.post('/analyze-screen', requireAuth, async (req, res) => {
  try {
    // Permission & Rate limit check (skip for admin)
    if (req.session.role !== 'admin' && req.session.role !== 'super_admin') {
      const perms = req.session.permissions || { canAnalyze: true };
      if (!perms.canAnalyze) {
        return res.status(403).json({ error: 'Screen analysis is disabled for your account.' });
      }

      // Key the limit by the unique account id, not the username — usernames are
      // only unique per organization, so keying by username made two different
      // users (in different orgs) share one daily limit.
      const limitCheck = await checkAnalyzeRateLimit(req.session.supabaseId || req.session.userId);
      if (!limitCheck.allowed) {
        return res.status(429).json({ error: limitCheck.error });
      }
    }

    // Credit gate for screen analysis (1 token). Super admin is fully exempt —
    // never limited, never charged. Users are charged their own credits; admins
    // are charged the admin balance. We pre-check here so we don't run the
    // (paid) AI call for an account that can't afford it, then deduct on success.
    const supabaseClient = req.app.locals.supabase;
    const chargeRole = req.session.role;
    const chargeAccountId = req.session.supabaseId;
    const chargeable = Boolean(supabaseClient && chargeAccountId && chargeRole !== 'super_admin');
    if (chargeable) {
      const table = chargeRole === 'admin' ? 'admins' : 'users';
      const { data: acct } = await supabaseClient.from(table).select('credits').eq('id', chargeAccountId).single();
      if (!acct || acct.credits < config.SCREEN_ANALYSIS_COST) {
        return res.status(402).json({ error: 'Insufficient credits for screen analysis', code: 'INSUFFICIENT_CREDITS' });
      }
    }

    const {
      screenshotBase64,
      sessionTranscript,
      image,
      transcript,
      preferredModel
    } = req.body || {};

    // Normalize screenshot
    let screenshot = '';
    if (typeof screenshotBase64 === 'string' && screenshotBase64.trim()) {
      screenshot = screenshotBase64.trim();
    } else if (typeof image === 'string' && image.trim()) {
      screenshot = image.trim();
    }
    if (!screenshot) {
      return res.status(400).json({ error: 'screenshotBase64 (or image) is required' });
    }

    let imageDataUrl = screenshot.startsWith('data:')
      ? screenshot
      : `data:image/png;base64,${screenshot}`;

    if (imageDataUrl.length > 26_214_400) {
      return res.status(413).json({ error: 'Screenshot too large (max 25MB)' });
    }

    // Normalize transcript
    let transcriptStr = '';
    if (typeof sessionTranscript === 'string') {
      transcriptStr = sessionTranscript;
    } else if (typeof transcript === 'string') {
      transcriptStr = transcript;
    } else if (Array.isArray(transcript)) {
      transcriptStr = transcript
        .map((t) => {
          const q = (t?.q || '').toString().trim();
          const a = (t?.a || '').toString().trim();
          return [q && `Q: ${q}`, a && `A: ${a}`].filter(Boolean).join('\n');
        })
        .filter(Boolean)
        .join('\n\n');
    }

    // Get previous transcript from Redis
    let redisTranscript = '';
    if (req.sessionID) {
      try {
        redisTranscript = await getTranscript(req.sessionID);
      } catch (err) {
        console.warn('[analyze-screen] failed to read redis transcript', err);
      }
    }

    const combinedTranscript = [redisTranscript, transcriptStr]
      .filter(Boolean)
      .join('\n\n')
      .trim()
      .slice(0, 50000);

    // Store transcript
    if (req.sessionID && combinedTranscript) {
      try {
        await storeTranscript(req.sessionID, combinedTranscript);
      } catch (err) {
        console.warn('[analyze-screen] failed to persist redis transcript', err);
      }
    }

    // Helper: Timeout wrapper
    const timeout = (prom, ms) => Promise.race([
      prom,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), ms))
    ]);

    // Vision models — env-overridable so they can be tuned on the host without a
    // redeploy. GPT-5.5 is a reasoning model: it rejects `temperature`, wants
    // `max_completion_tokens` (which also has to cover reasoning tokens), and
    // takes `reasoning_effort`. Default effort is 'medium' — noticeably better
    // code than 'low' without 'high'/'xhigh' latency. Set VISION_REASONING_EFFORT
    // to '' to omit it entirely (e.g. if pointed back at a non-reasoning model).
    const VISION_MODEL = process.env.VISION_MODEL || 'gpt-5.5';
    const VISION_REASONING_EFFORT = process.env.VISION_REASONING_EFFORT ?? 'medium';
    const VISION_ANTHROPIC_MODEL = process.env.VISION_ANTHROPIC_MODEL || 'claude-sonnet-5';
    const VISION_MAX_TOKENS = Number(process.env.VISION_MAX_TOKENS) || 16000;
    // Last-resort OpenAI model if the primary (and any Claude fallback) fails —
    // a plain, always-available model so the screen-reader never dead-ends.
    const VISION_SAFETY_MODEL = process.env.VISION_SAFETY_MODEL || 'gpt-4o';
    // reasoning_effort / max_completion_tokens are reasoning-model params; gpt-4o
    // and friends reject reasoning_effort, so gate it on the model family.
    const isReasoningModel = (m) => /^(o\d|gpt-[5-9])/i.test(String(m));

    // Helper: OpenAI Call with Fallback. Pass a modelOverride to run a specific
    // model (used for the gpt-4o safety net); defaults to VISION_MODEL.
    const callOpenAI = async (modelOverride) => {
      const model = modelOverride || VISION_MODEL;
      const content = [];
      if (combinedTranscript) {
        content.push({ type: 'text', text: `FULL TRANSCRIPT (from Redis):\n${combinedTranscript}` });
      }
      content.push({ type: 'text', text: VISION_PROMPT });
      content.push({ type: 'image_url', image_url: { url: imageDataUrl } });

      const keys = getOpenAIKeyPool();
      let lastError = null;

      for (let i = 0; i < keys.length; i++) {
        try {
          console.log(`[analyze-screen] Attempting OpenAI Vision (${model}) with Key #${i === 0 ? 'Primary' : i}`);
          // Dynamic client creation for fallback keys
          const fallbackClient = new OpenAI({ apiKey: keys[i] });

          // Reasoning models (gpt-5.x) reject `temperature` and use
          // `max_completion_tokens`; gpt-4o works with these too but rejects
          // `reasoning_effort`, so only send it to reasoning models.
          const params = {
            model,
            messages: [{ role: 'user', content }],
            max_completion_tokens: VISION_MAX_TOKENS,
            response_format: { type: 'json_object' }
          };
          if (VISION_REASONING_EFFORT && isReasoningModel(model)) params.reasoning_effort = VISION_REASONING_EFFORT;

          const response = await fallbackClient.chat.completions.create(params);

          const raw = response.choices?.[0]?.message?.content;
          if (!raw) {
            // A reasoning model that spent its whole budget thinking returns
            // empty content — surface it so we fail over to the next key/model
            // instead of throwing an opaque JSON.parse error.
            throw new Error(`Empty content (finish_reason: ${response.choices?.[0]?.finish_reason || 'unknown'})`);
          }
          return JSON.parse(raw);
        } catch (err) {
          console.warn(`[analyze-screen] Key #${i === 0 ? 'Primary' : i} failed:`, err.message);
          lastError = err;
        }
      }

      throw new Error(`All OpenAI keys failed for Vision model. Last error: ${lastError?.message}`);
    };

    // Helper: Anthropic Call
    const callAnthropic = async () => {
      const base64Data = imageDataUrl.split(',')[1];
      let promptText = VISION_PROMPT;
      if (combinedTranscript) {
        promptText = `FULL TRANSCRIPT (from Redis):\n${combinedTranscript}\n\n${VISION_PROMPT}`;
      }

      // claude-sonnet-5 also rejects sampling params like `temperature`.
      const { text } = await generateText({
        model: anthropic(VISION_ANTHROPIC_MODEL),
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: promptText },
              { type: 'image', image: base64Data }
            ]
          }
        ],
        maxTokens: 4096,
      });

      const s = text.indexOf('{');
      const e = text.lastIndexOf('}');
      if (s !== -1 && e !== -1) return JSON.parse(text.slice(s, e + 1));
      return JSON.parse(text);
    };

    // Build the model attempt chain, tried in order until one succeeds:
    //   1. the preferred model (GPT-5.5 by default, or Claude if requested+keyed)
    //   2. Claude Sonnet 5 — only if an Anthropic key is configured
    //   3. a gpt-4o safety net so the screen-reader never dead-ends
    // Only the first attempt is bounded by the timeout; fallbacks run to
    // completion since we're already past the "fast path" budget.
    const hasAnthropic = !!config.ANTHROPIC_API_KEY;
    const attempts = [];
    if (preferredModel === 'anthropic' && hasAnthropic) {
      attempts.push({ name: `Anthropic (${VISION_ANTHROPIC_MODEL})`, fn: () => callAnthropic() });
      attempts.push({ name: `OpenAI (${VISION_MODEL})`, fn: () => callOpenAI() });
    } else {
      attempts.push({ name: `OpenAI (${VISION_MODEL})`, fn: () => callOpenAI() });
      if (hasAnthropic) attempts.push({ name: `Anthropic (${VISION_ANTHROPIC_MODEL})`, fn: () => callAnthropic() });
    }
    if (VISION_SAFETY_MODEL && VISION_SAFETY_MODEL !== VISION_MODEL) {
      attempts.push({ name: `OpenAI safety (${VISION_SAFETY_MODEL})`, fn: () => callOpenAI(VISION_SAFETY_MODEL) });
    }

    let parsed;
    let lastErr = null;
    for (let a = 0; a < attempts.length; a++) {
      const { name, fn } = attempts[a];
      try {
        console.log(`[analyze-screen] Trying ${name}...`);
        parsed = a === 0
          ? await timeout(fn(), Number(process.env.VISION_TIMEOUT_MS) || 90000)
          : await fn();
        console.log(`[analyze-screen] ${name} succeeded`);
        break;
      } catch (err) {
        console.warn(`[analyze-screen] ${name} failed:`, err.message);
        lastErr = err;
      }
    }

    if (!parsed) {
      console.error(`[analyze-screen] All vision attempts failed. Last error:`, lastErr?.message);
      return res.status(502).json({ error: 'Analysis failed on all models.' });
    }

    if (!parsed || typeof parsed !== 'object') {
      return res.status(502).json({ error: 'bad_model_output', raw: 'Invalid JSON' });
    }

    const analysis = String(parsed.analysis || '').trim();
    const keyPoints = String(parsed.key_points || '').trim();
    const answerGuidance = String(parsed.answer_guidance || '').trim();
    // Display-only, first-person version for the on-screen insight card. It is
    // deliberately NOT part of screenAnalysisContext, so what reaches the model
    // is unchanged.
    const spokenAnswer = String(parsed.spoken_answer || '').trim();
    // Screen type + extracted code — display-only (the code to type, a type
    // badge). Also kept out of screenAnalysisContext.
    const screenType = String(parsed.type || 'other').trim();
    const code = parsed.code && typeof parsed.code === 'object'
      ? { language: String(parsed.code.language || '').trim(), code: String(parsed.code.code || '').trim() }
      : { language: '', code: '' };

    const screenAnalysisContext =
      analysis && answerGuidance
        ? `<SCREEN_ANALYSIS>\n${analysis}\n\n${answerGuidance}\n</SCREEN_ANALYSIS>`
        : '';

    if (req.session && screenAnalysisContext) {
      req.session.screenAnalysisContext = screenAnalysisContext;
      try {
        await new Promise((resolve, reject) =>
          req.session.save((err) => (err ? reject(err) : resolve()))
        );
      } catch (err) {
        console.warn('[analyze-screen] session save failed', err);
      }
    }

    if (req.sessionID && screenAnalysisContext) {
      try {
        await storeScreenAnalysis(req.sessionID, screenAnalysisContext);
      } catch (err) {
        console.warn('[analyze-screen] failed to persist screen analysis', err);
      }
    }

    // Charge for the analysis now that it succeeded. Super admin is exempt.
    if (chargeable) {
      const adminId = chargeRole === 'user' ? req.session.adminId : chargeAccountId;
      const charge = await chargeScreenAnalysis(supabaseClient, chargeAccountId, adminId, chargeRole);
      if (!charge.success) {
        console.warn('[analyze-screen] post-analysis charge failed:', charge.error);
      }
    }

    return res.json({
      type: screenType,
      analysis,
      key_points: keyPoints,
      answer_guidance: answerGuidance,
      spoken_answer: spokenAnswer,
      code,
      screen_analysis_context: screenAnalysisContext,
    });
  } catch (err) {
    console.error('[analyze-screen] error:', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});



export default router;

