/**
 * Reasoning Routes
 * Handles the "Reasoning" architecture mode:
 * 1. POST /api/reasoning/transcribe  — receives audio blob, returns Whisper transcript
 * 2. POST /api/reasoning/answer      — receives transcript text, streams GPT response
 *
 * Live architecture (WebRTC realtime) is completely separate and untouched.
 */

import express from 'express';
import OpenAI from 'openai';
import multer from 'multer';
import config from '../config/index.js';
import { requireAuth } from '../middleware/auth.js';
import { buildInterviewInstructions } from '../utils/prompts.js';
import { getResume, getAssignment, getJobDescription } from './interview.js';

const router = express.Router();

// OpenAI client
const openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });

// multer: store audio in memory (max 25 MB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

// ── Opener-variety rotation ────────────────────────────────────────────────
// This endpoint answers each question in a fresh, stateless request, so the
// model can't see how it opened previous answers — left alone it reaches for
// the same "Yeah so"/"So honestly" opener every time. Rotate a one-shot opening
// directive per request so answers genuinely vary from one to the next.
const OPENER_STYLES = [
  'Go straight into the substance — the point or the story — with no preamble at all.',
  'Open on a specific concrete moment or number from your experience ("At [company] we had a quarter where..."), then widen out.',
  'React to the exact thing they asked, name it, and then dive in.',
  'Lead with a short, blunt one-line take, then unpack it in the next breath.',
  'Give the outcome or the punchline first, then back up and explain how you got there.',
  'Open mid-thought as if continuing a train of thought — but NOT with "so", "yeah", "honestly", or "well".',
  'Frame the tension or tradeoff at the heart of the question, then take your side.',
  'Start with a quick concrete image or scene from the work, then explain what it means.',
];
let openerRotation = 0;

/**
 * POST /api/reasoning/transcribe
 * Accepts a raw audio file (webm/ogg/mp4/wav) and returns a Whisper transcript.
 *
 * Body: multipart/form-data
 *   audio  — the recorded audio blob
 *
 * Transcription is always forced to English (interview audio is English-only).
 */
router.post('/api/reasoning/transcribe', requireAuth, upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided.' });
    }

    console.log(`[Reasoning] Transcribing audio: ${req.file.size} bytes, mime: ${req.file.mimetype}`);

    // Determine a sensible file extension for Whisper
    let filename = 'audio.webm';
    if (req.file.mimetype.includes('ogg')) filename = 'audio.ogg';
    else if (req.file.mimetype.includes('mp4')) filename = 'audio.mp4';
    else if (req.file.mimetype.includes('wav')) filename = 'audio.wav';
    else if (req.file.mimetype.includes('mpeg') || req.file.mimetype.includes('mp3')) filename = 'audio.mp3';

    // Create a File-like object from the buffer (required by OpenAI Node SDK v4+)
    const audioFile = new File([req.file.buffer], filename, { type: req.file.mimetype });

    // Force English + greedy decoding. Interview audio is English-only; letting
    // Whisper auto-detect (or run with a non-zero temperature) makes it flip to a
    // random language and hallucinate gibberish on short/quiet/noisy clips.
    const transcription = await openai.audio.transcriptions.create({
      file: audioFile,
      model: 'whisper-1',
      language: 'en',
      temperature: 0,
    });

    console.log(`[Reasoning] Transcript: "${transcription.text}"`);
    return res.json({ ok: true, transcript: transcription.text.trim() });

  } catch (err) {
    console.error('[Reasoning Transcribe] Error:', err);
    return res.status(500).json({ error: String(err.message || err) });
  }
});

/**
 * POST /api/reasoning/answer
 * Accepts a transcript (text) + optional context and streams a GPT answer back
 * using Server-Sent Events so the frontend can display it character-by-character.
 *
 * Body JSON:
 *   transcript    — the user's spoken question (string)
 *   interviewMode — 'smart' | 'hr' | 'technical' | 'vp'
 *   jd            — job description override (optional, frontend sends its local JD)
 *   steering      — optional steering note queued in the UI; mixed into the
 *                   prompt as a system message so the question stays untouched
 */
router.post('/api/reasoning/answer', requireAuth, async (req, res) => {
  try {
    const { transcript, interviewMode = 'smart', jd, steering } = req.body || {};

    if (!transcript || typeof transcript !== 'string' || !transcript.trim()) {
      return res.status(400).json({ error: 'transcript is required.' });
    }

    console.log(`[Reasoning] Answering transcript (mode=${interviewMode}): "${transcript.slice(0, 100)}..."`);

    // Build the same system prompt used by the Live architecture
    const systemPrompt = buildInterviewInstructions({
      interviewMode,
      resume: getResume(),
      assignment: getAssignment(),
      jobDescription: jd || getJobDescription(req),
      screenAnalysisContext: req.session?.screenAnalysisContext || '',
    });

    // Set up SSE headers so the frontend receives streaming chunks
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const sendEvent = (data) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // Stream from GPT-4.1 (or whatever model string is configured)
    const MODEL = process.env.REASONING_MODEL || 'gpt-5.4-2026-03-05';
    console.log(`[Reasoning] ✅ Model confirmed: ${MODEL}`);

    const messages = [
      { role: 'system', content: systemPrompt },
    ];

    // One-shot opening directive so stateless answers don't all start the same
    // way (see OPENER_STYLES). Rotates on every request.
    const openerStyle = OPENER_STYLES[openerRotation % OPENER_STYLES.length];
    openerRotation = (openerRotation + 1) % OPENER_STYLES.length;
    messages.push({
      role: 'system',
      content: `[Opening style for THIS answer only — never mention or acknowledge this note] ${openerStyle} Do NOT begin with "Yeah so" or "So honestly", and don't reuse a stock opener.`,
    });

    if (steering && typeof steering === 'string' && steering.trim()) {
      messages.push({ role: 'system', content: steering.trim().slice(0, 1000) });
    }
    messages.push({ role: 'user', content: transcript.trim() });

    const stream = await openai.chat.completions.create({
      model: MODEL,
      stream: true,
      messages,
      max_completion_tokens: 6000,
    });

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) {
        sendEvent({ type: 'delta', delta });
      }
    }

    sendEvent({ type: 'done' });
    res.end();

  } catch (err) {
    console.error('[Reasoning Answer] Error:', err);
    // Try to send an error event if the stream is still open
    try {
      res.write(`data: ${JSON.stringify({ type: 'error', error: String(err.message || err) })}\n\n`);
      res.end();
    } catch (_) {
      res.status(500).end();
    }
  }
});

/**
 * POST /api/steer-suggestions
 * Generates short, conversation-aware "steering nudge" chips for the UI's
 * "Steer the next answer" bar (e.g. "Add a concrete metric", "Tie it to the
 * payments launch story"). Cheap, non-streaming call on a small model.
 *
 * Body JSON:
 *   jd     — current job description text (optional)
 *   turns  — recent [{ q, a }] pairs from the transcript (optional)
 */
router.post('/api/steer-suggestions', requireAuth, async (req, res) => {
  try {
    const { jd = '', turns = [] } = req.body || {};

    const convo = (Array.isArray(turns) ? turns : [])
      .slice(-4)
      .map((t, i) => `Q${i + 1}: ${String(t?.q || '').slice(0, 300)}\nA${i + 1}: ${String(t?.a || '').slice(0, 500)}`)
      .join('\n');

    const MODEL = process.env.SUGGESTIONS_MODEL || 'gpt-4o-mini';

    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: 'system',
          content: 'You coach a candidate live during a job interview. Based on the job description and the conversation so far, suggest 3 "steering nudges" the candidate could apply to their NEXT answer. Each nudge is a short imperative phrase under 9 words, e.g. "Add a concrete metric", "Tie it to the payments launch story", "Mention the 99.95% SLO from the JD". Make them specific to this conversation when possible. Reply with ONLY a JSON array of 3 strings.',
        },
        {
          role: 'user',
          content: `JOB DESCRIPTION:\n${String(jd).slice(0, 1500) || '(none provided)'}\n\nCONVERSATION SO FAR:\n${convo || '(no questions asked yet)'}`,
        },
      ],
      max_completion_tokens: 150,
    });

    const raw = completion.choices?.[0]?.message?.content || '[]';
    const match = raw.match(/\[[\s\S]*\]/);
    let suggestions = [];
    try {
      suggestions = JSON.parse(match ? match[0] : raw);
    } catch (_) {
      suggestions = [];
    }
    suggestions = (Array.isArray(suggestions) ? suggestions : [])
      .filter((s) => typeof s === 'string' && s.trim())
      .map((s) => s.trim().slice(0, 60))
      .slice(0, 3);

    res.json({ suggestions });
  } catch (err) {
    console.error('[Steer Suggestions] Error:', err);
    res.status(500).json({ error: 'suggestion generation failed', suggestions: [] });
  }
});

export default router;
