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

// Setup multer for in-memory audio buffer parsing
const upload = multer({ storage: multer.memoryStorage() });
import { requireAuth } from '../middleware/auth.js';
import { checkAnalyzeRateLimit } from '../middleware/rateLimit.js';
import { getTranscript, storeTranscript, storeScreenAnalysis } from '../lib/redis.js';
import { buildInterviewInstructions, VISION_PROMPT } from '../utils/prompts.js';
import { startSession, endSession, getActiveSession } from '../services/credits.js';
import { sanitizeText } from '../utils/sanitize.js';

const router = express.Router();

// OpenAI client
const openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });

// Anthropic client
const anthropic = createAnthropic({
  apiKey: config.ANTHROPIC_API_KEY,
});

// In-memory storage for resume, assignment, and JD
let resume = '';
let assignment = '';
let JOB_DESC = '';

/**
 * Load resume and assignment from files
 */
export function loadDocuments(resumeText, assignmentText) {
  resume = resumeText || '';
  assignment = assignmentText || '';
}

export function getResume() { return resume; }
export function getAssignment() { return assignment; }
export function getJobDescription() { return JOB_DESC; }

/**
 * POST /set-jd - Update Job Description
 */
router.post('/set-jd', (req, res) => {
  const rawJd = (req.body?.jd || '').toString();
  // Sanitize input: Strip HTML/Scripts and enforce length
  JOB_DESC = sanitizeText(rawJd, 20000);
  return res.json({ ok: true, length: JOB_DESC.length });
});

/**
 * POST /session - Create OpenAI Realtime session
 */
router.post('/session', requireAuth, async (req, res) => {
  try {
    const supabase = req.app.locals.supabase;
    if (!supabase) return res.status(503).json({ error: 'Database not configured' });

    const userId = req.session.supabaseId;
    const adminId = req.session.adminId;

    // 1. Enforce single active session & deduct initial credit
    // startSession returns { success, session, error }
    const result = await startSession(supabase, userId, adminId);
    if (!result.success) {
      console.warn(`[Session] Start failed for user ${userId}:`, result.error);
      return res.status(400).json({ error: result.error });
    }

    const dbSession = result.session;
    console.log(`→ Session ${dbSession.id} created for user ${userId}`);

    // 2. Build instructions for OpenAI
    const mode = (req.body?.mode || 'smart').toString().toLowerCase();
    const interviewMode = (req.body?.interviewMode || 'smart').toString().toLowerCase();
    const screenAnalysisContext = req.session?.screenAnalysisContext || '';

    const fullInstructions = buildInterviewInstructions({
      interviewMode,
      resume,
      assignment,
      jobDescription: JOB_DESC,
      screenAnalysisContext,
    });

    if (req.session) req.session.mode = mode;

    // 3. Request OpenAI ephemeral key
    const r = await fetch('https://api.openai.com/v1/realtime/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-realtime-preview',
        modalities: ['text'],
        input_audio_format: 'pcm16',
        turn_detection: {
          type: 'server_vad',
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 1200,
          create_response: true,
          interrupt_response: true,
        },
        input_audio_transcription: {
          model: 'gpt-4o-transcribe',
          language: 'en'
        },
        instructions: fullInstructions,
      }),
    });

    const session = await r.json();
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
    const activeSession = await getActiveSession(supabase, userId);

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

      const limitCheck = await checkAnalyzeRateLimit(req.session.userId);
      if (!limitCheck.allowed) {
        return res.status(429).json({ error: limitCheck.error });
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

    // Helper: OpenAI Call
    const callOpenAI = async () => {
      const content = [];
      if (combinedTranscript) {
        content.push({ type: 'text', text: `FULL TRANSCRIPT (from Redis):\n${combinedTranscript}` });
      }
      content.push({ type: 'text', text: VISION_PROMPT });
      content.push({ type: 'image_url', image_url: { url: imageDataUrl } });

      const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [{ role: 'user', content }],
        temperature: 0.4,
        max_tokens: 3000,
        response_format: { type: 'json_object' }
      });
      return JSON.parse(response.choices[0].message.content);
    };

    // Helper: Anthropic Call
    const callAnthropic = async () => {
      const base64Data = imageDataUrl.split(',')[1];
      let promptText = VISION_PROMPT;
      if (combinedTranscript) {
        promptText = `FULL TRANSCRIPT (from Redis):\n${combinedTranscript}\n\n${VISION_PROMPT}`;
      }

      const { text } = await generateText({
        model: anthropic('claude-3-5-sonnet'),
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: promptText },
              { type: 'image', image: base64Data }
            ]
          }
        ],
        maxTokens: 3000,
        temperature: 0.4,
      });

      const s = text.indexOf('{');
      const e = text.lastIndexOf('}');
      if (s !== -1 && e !== -1) return JSON.parse(text.slice(s, e + 1));
      return JSON.parse(text);
    };

    let parsed;
    const primary = preferredModel === 'anthropic' ? callAnthropic : callOpenAI;
    const secondary = preferredModel === 'anthropic' ? callOpenAI : callAnthropic;
    const primaryName = preferredModel === 'anthropic' ? 'Anthropic' : 'OpenAI';
    const secondaryName = preferredModel === 'anthropic' ? 'OpenAI' : 'Anthropic';

    try {
      console.log(`[analyze-screen] Trying ${primaryName}...`);
      parsed = await timeout(primary(), 30000);
    } catch (err) {
      console.warn(`[analyze-screen] ${primaryName} failed/timeout:`, err.message);
      console.log(`[analyze-screen] Falling back to ${secondaryName}...`);
      try {
        parsed = await secondary();
        console.log(`[analyze-screen] ${secondaryName} fallback succeeded`);
      } catch (err2) {
        console.error(`[analyze-screen] Both models failed.`);
        return res.status(502).json({ error: 'Analysis failed on both models.' });
      }
    }

    if (!parsed || typeof parsed !== 'object') {
      return res.status(502).json({ error: 'bad_model_output', raw: 'Invalid JSON' });
    }

    const analysis = String(parsed.analysis || '').trim();
    const keyPoints = String(parsed.key_points || '').trim();
    const answerGuidance = String(parsed.answer_guidance || '').trim();

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

    return res.json({
      analysis,
      key_points: keyPoints,
      answer_guidance: answerGuidance,
      screen_analysis_context: screenAnalysisContext,
    });
  } catch (err) {
    console.error('[analyze-screen] error:', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

/**
 * POST /classic-interview/turn
 * The custom STT -> GPT-4.1 -> TTS pipeline for the alternative slower architecture.
 */
router.post('/classic-interview/turn', requireAuth, upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided.' });
    }

    // 1. STT: Send user audio to OpenAI Whisper
    const mime = req.file.mimetype || 'audio/webm';
    const ext = mime.includes('mp4') ? 'm4a' : (mime.includes('mpeg') ? 'mp3' : 'weba');

    const formData = new FormData();
    formData.append('file', req.file.buffer, {
      filename: `audio.${ext}`,
      contentType: mime
    });
    formData.append('model', 'whisper-1');
    formData.append('language', 'en');

    const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.OPENAI_API_KEY}`,
        ...formData.getHeaders()
      },
      body: formData
    });

    if (!whisperRes.ok) throw new Error(`Whisper failed: ${await whisperRes.text()}`);
    const whisperData = await whisperRes.json();
    const userTranscript = whisperData.text || '';

    // If the user's transcript is empty (just silence), abort early
    if (userTranscript.trim().length === 0) {
      return res.json({ transcript: "...", responseText: "I didn't quite catch that.", audio: null });
    }

    // 2. Build Instructions for GPT-4.1
    const { mode: preferredMode, interviewMode: preferredLayer } = req.session || {};
    const mode = preferredMode || 'smart';
    const interviewMode = preferredLayer || 'smart';
    const screenAnalysisContext = req.session?.screenAnalysisContext || '';

    // Reconstruct the full instructions dynamically using prompts.js
    let systemPrompt = promptConfig.buildInterviewInstructions({
      interviewMode,
      resume: "(resume context omitted for brevity, fetch from DB ideally)",
      assignment: "(assignment context omitted)",
      jobDescription: JOB_DESC,
      screenAnalysisContext
    });

    // 3. LLM: Send user text to GPT-4.1
    const gptResponse = await openai.chat.completions.create({
      model: 'gpt-4.1',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userTranscript }
      ],
      temperature: 0.7,
      max_tokens: 500
    });

    const aiTextResponse = gptResponse.choices[0]?.message?.content || "I don't know what to say.";

    // 4. TTS: Send AI text to OpenAI TTS for audio streaming
    const ttsRes = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'tts-1',
        voice: 'alloy',
        input: aiTextResponse,
        response_format: 'mp3'
      })
    });

    if (!ttsRes.ok) throw new Error(`TTS failed: ${await ttsRes.text()}`);
    const audioBuffer = await ttsRes.buffer();

    // 5. Respond to frontend
    // Set headers to expose the audio length to the browser
    res.set({
      'Content-Type': 'application/json'
    });

    return res.json({
      transcript: userTranscript,
      responseText: aiTextResponse,
      audioBase64: audioBuffer.toString('base64')
    });

  } catch (err) {
    console.error('[classic-interview/turn] Pipeline error:', err);
    return res.status(500).json({ error: 'Pipeline error occurred.' });
  }
});

export default router;

