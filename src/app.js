/**
 * Express Application Setup
 * Configures middleware, routes, and static file serving
 */

import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import config from './config/index.js';
import { connectRedis, forceLogoutUser, forceLogoutAdmin, forceLogoutAllUsersUnderAdmin } from './lib/redis.js';
import { initSupabase, getSupabase } from './lib/supabase.js';
import { createSessionMiddleware, sessionAnnotator } from './middleware/session.js';
import { requireAuth, requireSuperAdmin, requireConsultancyAdmin, requireUser } from './middleware/auth.js';
import {
  authRoutes,
  superAdminRoutes,
  adminRoutes,
  userRoutes,
  interviewRoutes,
} from './routes/index.js';
import { loadDocuments } from './routes/interview.js';

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

  // Trust proxy for Render/Railway
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

  // Session middleware
  app.use(createSessionMiddleware());

  console.log('🚀 Server starting... (Version: Multi-Tenant Dashboard v2 - Refactored)');
  console.log('ℹ️  Super Admin auth via SUPER_ADMIN_USERNAME / SUPER_ADMIN_PASSWORD env vars');

  // Load resume and assignment
  loadResumeFiles();

  // Mount API routes (auth routes before requireAuth)
  app.use('/api', authRoutes);

  // Serve login page
  app.get('/login', (req, res) => {
    if (req.session?.userId) return res.redirect('/');
    res.sendFile(path.join(ROOT_DIR, 'public', 'login.html'));
  });

  // Auth gate (protect everything else)
  app.use(requireAuth);

  // Post-auth session annotator
  app.use(sessionAnnotator);

  // Mount protected API routes
  app.use('/api/super-admin', superAdminRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/user', userRoutes);
  app.use('/', interviewRoutes);

  // Dashboard routes
  setupDashboardRoutes(app);

  // Static file serving
  setupStaticRoutes(app);

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
 * Setup dashboard routes
 */
function setupDashboardRoutes(app) {
  // Super Admin Dashboard
  app.use(
    '/super-admin',
    requireSuperAdmin,
    express.static(path.join(ROOT_DIR, 'dashboards', 'super-admin', 'dist'))
  );
  app.get('/super-admin/*', requireSuperAdmin, (req, res) => {
    res.sendFile(path.join(ROOT_DIR, 'dashboards', 'super-admin', 'dist', 'index.html'));
  });

  // Admin (Consultancy) Dashboard
  app.use(
    '/admin-dashboard',
    requireConsultancyAdmin,
    express.static(path.join(ROOT_DIR, 'dashboards', 'admin', 'dist'))
  );
  app.get('/admin-dashboard/*', requireConsultancyAdmin, (req, res) => {
    res.sendFile(path.join(ROOT_DIR, 'dashboards', 'admin', 'dist', 'index.html'));
  });

  // User (Candidate) Dashboard
  app.use(
    '/user-dashboard',
    requireUser,
    express.static(path.join(ROOT_DIR, 'dashboards', 'user', 'dist'))
  );
  app.get('/user-dashboard/*', requireUser, (req, res) => {
    res.sendFile(path.join(ROOT_DIR, 'dashboards', 'user', 'dist', 'index.html'));
  });
}

/**
 * Setup static file serving
 */
function setupStaticRoutes(app) {
  // Public React app
  app.use(express.static(path.join(ROOT_DIR, 'public', 'build')));

  // SPA fallback
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/session') ||
      req.path.startsWith('/set-jd') || req.path.startsWith('/analyze-screen')) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.sendFile(path.join(ROOT_DIR, 'public', 'build', 'index.html'));
  });
}

export default createApp;
