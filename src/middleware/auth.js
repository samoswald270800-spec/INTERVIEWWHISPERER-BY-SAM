/**
 * Authentication Middleware
 */

import { redisClient } from '../lib/redis.js';

/**
 * Require any authenticated user
 */
export async function requireAuth(req, res, next) {
  // Public paths that unauthenticated visitors can access
  const isPublicPath = (
    req.path === '/login' ||
    req.path === '/login.html' ||
    req.path === '/api/login' ||
    req.path === '/' ||
    req.path === '/landing.html' ||
    req.path === '/tutorial.html' ||
    req.path.startsWith('/assets/') ||
    req.path.startsWith('/api/auth/')
  );

  if (req.session?.userId) {
    // SECURITY FIX: User Status Check
    // Verify that the user is still 'active' in the database.
    // This enforces immediate logout if suspended/banned — even on public paths like '/'.
    try {
      const supabase = req.app.locals.supabase;
      if (supabase && req.session.supabaseId && req.session.role !== 'super_admin') {
        const table = req.session.role === 'admin' ? 'admins' : 'users';
        const { data: account, error } = await supabase
          .from(table)
          .select('status')
          .eq('id', req.session.supabaseId)
          .single();

        if (error || !account || account.status !== 'active') {
          console.warn(`[Auth] Session invalid: User ${req.session.userId} is ${account?.status || 'unknown'}. destroying session.`);
          return req.session.destroy(() => {
            if (req.xhr || req.headers.accept?.indexOf('json') > -1) {
              return res.status(401).json({ error: 'Account suspended or inactive' });
            }
            res.redirect('/login?error=suspended');
          });
        }
      }
    } catch (err) {
      console.error('[Auth] Status check failed:', err);
    }

    // FIX: Refresh active_sessions TTL to match session activity
    // This prevents "Ghost Sessions" where the concurrency lock expires before the session does.
    if (req.session.role !== 'admin' && req.session.role !== 'super_admin') {
      const activeKey = `active_sessions:${req.session.userId}`;
      redisClient.expire(activeKey, 6 * 3600).catch(() => { });
    }
    return next();
  }

  // Not authenticated — allow public paths, redirect everything else to login
  if (isPublicPath) {
    return next();
  }

  console.log(`[Auth] No session found. Redirecting to /login. (SessionID: ${req.sessionID})`);
  return res.redirect('/login');
}

/**
 * Require Admin role (legacy admin or super_admin)
 */
export function requireAdmin(req, res, next) {
  if (req.session?.role === 'admin' || req.session?.role === 'super_admin') {
    return next();
  }
  return res.status(403).json({ error: 'Admin only' });
}

/**
 * Require Super Admin role
 */
export function requireSuperAdmin(req, res, next) {
  if (req.session?.role === 'super_admin') {
    return next();
  }
  return res.status(403).json({ error: 'Super Admin only' });
}

/**
 * Require Consultancy Admin role
 */
export function requireConsultancyAdmin(req, res, next) {
  if (req.session?.role === 'admin') {
    return next();
  }
  return res.status(403).json({ error: 'Consultancy Admin only' });
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
  requireAdmin,
  requireSuperAdmin,
  requireConsultancyAdmin,
  requireUser,
};

