/**
 * Express Application Setup
 * Desktop App Version - Super Admin, Admin, and User
 */

import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import config from './config/index.js';
import { connectRedis } from './lib/redis.js';
import { initSupabase, getSupabase } from './lib/supabase.js';
import { createSessionMiddleware, sessionAnnotator } from './middleware/session.js';
import { requireAuth } from './middleware/auth.js';
import {
  authRoutes,
  userRoutes,
  interviewRoutes,
  reasoningRoutes,
} from './routes/index.js';
import superAdminRoutes from './routes/super-admin.js';
import adminRoutes from './routes/admin.js';
import { loadDocuments } from './routes/interview.js';
import {
  forceLogoutUser,
  forceLogoutAdmin,
  forceLogoutAllUsersUnderAdmin,
} from './lib/redis.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, '..');

/**
 * Create and configure Express app
 */
export async function createApp() {
  const app = express();

  // Validate config
  config.validateConfig();

  // Trust proxy for Railway
  app.set('trust proxy', 1);

  // Parse JSON
  app.use(express.json({ limit: '25mb' }));

  // Initialize Redis
  await connectRedis();

  // Initialize Supabase
  initSupabase();
  const supabase = getSupabase();

  // Store clients in app.locals
  app.locals.supabase = supabase;
  app.locals.forceLogoutUser = forceLogoutUser;
  app.locals.forceLogoutAdmin = forceLogoutAdmin;
  app.locals.forceLogoutAllUsersUnderAdmin = forceLogoutAllUsersUnderAdmin;

  // Session middleware — create once, reuse for Socket.IO
  const sessionMw = createSessionMiddleware();
  app.locals.sessionMiddleware = sessionMw;
  app.use(sessionMw);

  console.log('🚀 Interview Whisperer Desktop App starting...');

  // Load resume and assignment
  loadResumeFiles();

  // Mount API routes (auth routes before requireAuth)
  app.use('/api', authRoutes);

  // Serve login page (both /login and /login.html for Electron compatibility)
  app.get(['/login', '/login.html'], (req, res) => {
    if (req.session?.userId) return res.redirect('/');
    // Prefer built version (has hashed asset refs), fallback to source
    const builtLogin = path.join(ROOT_DIR, 'public', 'build', 'login.html');
    const srcLogin = path.join(ROOT_DIR, 'public', 'login.html');
    res.sendFile(fs.existsSync(builtLogin) ? builtLogin : srcLogin);
  });

  // Serve static assets (CSS, JS, images) BEFORE auth - these are public
  app.use('/assets', express.static(path.join(ROOT_DIR, 'public', 'build', 'assets')));
  app.use('/src', express.static(path.join(ROOT_DIR, 'public', 'build', 'src')));

  // ===== AUTH GATE: Everything below requires authentication =====
  app.use(requireAuth);

  // Post-auth session annotator
  app.use(sessionAnnotator);

  // WebRTC ICE server config for remote control (authenticated — may carry TURN creds)
  app.get('/api/webrtc/ice-config', (req, res) => {
    res.json({ iceServers: buildIceServers() });
  });

  // Mount protected API routes
  app.use('/api/user', userRoutes);
  app.use('/api/super-admin', superAdminRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/', interviewRoutes);
  app.use('/', reasoningRoutes);

  // Serve index.html (protected by auth above)
  app.get('*', (req, res) => {
    // For API routes that don't exist, return 404 JSON
    if (req.path.startsWith('/api') || req.path.startsWith('/session') ||
      req.path.startsWith('/set-jd') || req.path.startsWith('/get-jd') || req.path.startsWith('/analyze-screen')) {
      return res.status(404).json({ error: 'Not found' });
    }
    // For all other routes, serve the React SPA (already protected by auth)
    res.sendFile(path.join(ROOT_DIR, 'public', 'build', 'index.html'));
  });

  return app;
}

/**
 * Load resume and assignment files
 */
function loadResumeFiles() {
  let resume = '';
  let assignment = '';

  try {
    resume = fs.readFileSync(path.join(ROOT_DIR, 'resume.txt'), 'utf8');
    console.log('ℹ️  Loaded resume.txt');
  } catch {
    console.log('ℹ️  No resume.txt found (optional).');
  }

  try {
    assignment = fs.readFileSync(path.join(ROOT_DIR, 'assignment.txt'), 'utf8');
    console.log('ℹ️  Loaded assignment.txt');
  } catch {
    console.log('ℹ️  No assignment.txt found (optional).');
  }

  loadDocuments(resume, assignment);
}

/**
 * Build the ICE server list for WebRTC remote control.
 *
 * Defaults to public Google STUN (enough for most home networks). For
 * restrictive/symmetric NATs a TURN relay is required — provide one via env:
 *   - WEBRTC_ICE_SERVERS : full JSON array of RTCIceServer objects (overrides all)
 *   - TURN_URL / TURN_USERNAME / TURN_CREDENTIAL : a single TURN server
 */
function buildIceServers() {
  // Full override wins
  if (process.env.WEBRTC_ICE_SERVERS) {
    try {
      const custom = JSON.parse(process.env.WEBRTC_ICE_SERVERS);
      if (Array.isArray(custom) && custom.length) return custom;
    } catch (e) {
      console.warn('Invalid WEBRTC_ICE_SERVERS JSON, falling back to defaults:', e.message);
    }
  }

  const servers = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  ];

  if (process.env.TURN_URL) {
    servers.push({
      urls: process.env.TURN_URL,
      username: process.env.TURN_USERNAME || '',
      credential: process.env.TURN_CREDENTIAL || '',
    });
  }

  return servers;
}

export default createApp;

