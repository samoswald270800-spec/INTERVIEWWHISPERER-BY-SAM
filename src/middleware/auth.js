/**
 * Authentication Middleware
 * Desktop App - User Auth Only
 */

import { redisClient } from '../lib/redis.js';

/**
 * Require authenticated user
 */
export function requireAuth(req, res, next) {
  // Allow login page and login endpoint
  if (req.path === '/login' || req.path === '/api/login') return next();

  // Allow auth endpoints (login doesn't require existing session)
  if (req.path.startsWith('/api/auth/')) return next();

  if (req.session?.userId) {
    // Refresh active_sessions TTL to match session activity
    const activeKey = `active_sessions:supabase:${req.session.supabaseId}`;
    redisClient.expire(activeKey, 6 * 3600).catch(() => { });
    return next();
  }

  // Return JSON 401 for API requests
  if (req.path.startsWith('/api') || req.xhr || req.headers.accept?.includes('application/json')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  console.log(`[Auth] No session found. Redirecting to /login.`);
  return res.redirect('/login');
}

/**
 * Require User role
 */
export function requireUser(req, res, next) {
  if (req.session?.role === 'user') {
    return next();
  }
  return res.status(403).json({ error: 'User only' });
}

export default {
  requireAuth,
  requireUser,
};
