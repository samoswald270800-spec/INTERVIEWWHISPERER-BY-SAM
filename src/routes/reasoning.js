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
 */
router.post('/api/reasoning/answer', requireAuth, async (req, res) => {
  try {
    const { transcript, interviewMode = 'smart', jd } = req.body || {};

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

    const stream = await openai.chat.completions.create({
      model: MODEL,
      stream: true,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: transcript.trim() },
      ],
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

export default router;
