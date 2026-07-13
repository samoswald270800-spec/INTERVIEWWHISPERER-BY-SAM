/**
 * Authentication Routes
 * Desktop App - Super Admin, Admin, and User Authentication
 */

import express from 'express';
import { getDeviceFingerprint } from '../middleware/session.js';
import {
  addActiveSession,
  removeActiveSession,
  getActiveSessions,
  deleteSessionData,
  redisClient,
} from '../lib/redis.js';
import { authenticateSuperAdmin, authenticateAdmin, authenticateUser, logAudit } from '../services/auth.js';
import { resolveUserPermissions, resolveAdminPermissions } from '../services/permissions.js';

const router = express.Router();

/**
 * POST /api/auth/super-admin - Super Admin login (env vars)
 */
router.post('/auth/super-admin', async (req, res) => {
  try {
    const supabase = req.app.locals.supabase;
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const result = await authenticateSuperAdmin(username, password);
    if (!result.success) {
      return res.status(401).json({ error: result.error });
    }

    req.session.userId = result.user.username;
    req.session.supabaseId = result.user.id;
    req.session.role = 'super_admin';
    req.session.ip = req.headers['x-forwarded-for'] || req.ip;
    req.session.userAgent = req.headers['user-agent'] || '';
    req.session.loginAt = Date.now();

    if (supabase) {
      await logAudit(supabase, {
        actorType: 'super_admin',
        actorId: result.user.id,
        action: 'login',
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }

    await addActiveSession(`supabase:${result.user.id}`, req.sessionID);
    console.log(`[Auth] Super Admin logged in: ${result.user.username} -> Session: ${req.sessionID}`);

    return req.session.save((err) => {
      if (err) {
        console.error('Super Admin session save error:', err);
        return res.status(500).json({ error: 'Login failed (session error)' });
      }
      return res.json({ ok: true, role: 'super_admin', user: result.user });
    });
  } catch (e) {
    console.error('Super Admin login error:', e);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/auth/admin - Admin (Consultancy) login
 */
router.post('/auth/admin', async (req, res) => {
  try {
    const supabase = req.app.locals.supabase;
    if (!supabase) {
      return res.status(503).json({ error: 'Database not configured' });
    }

    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const result = await authenticateAdmin(supabase, username, password);
    if (!result.success) {
      return res.status(401).json({ error: result.error });
    }

    req.session.regenerate(async (err) => {
      if (err) {
        console.error('Admin session regenerate error:', err);
        return res.status(500).json({ error: 'Login failed (session error)' });
      }

      req.session.userId = result.user.username;
      req.session.supabaseId = result.user.id;
      req.session.role = 'admin';
      req.session.credits = result.user.credits;
      req.session.adminName = result.user.name;
      req.session.ip = req.headers['x-forwarded-for'] || req.ip;
      req.session.userAgent = req.headers['user-agent'] || '';
      req.session.loginAt = Date.now();

      await addActiveSession(`supabase:${result.user.id}`, req.sessionID);

      await logAudit(supabase, {
        actorType: 'admin',
        actorId: result.user.id,
        action: 'login',
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });

      return req.session.save((err) => {
        if (err) {
          console.error('Admin session save error:', err);
          return res.status(500).json({ error: 'Login failed (session error)' });
        }
        console.log(`[Auth] Admin logged in: ${result.user.username}`);
        return res.json({ ok: true, role: 'admin', user: result.user });
      });
    });
  } catch (e) {
    console.error('Admin login error:', e);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/auth/user - User (Candidate) login
 */
router.post('/auth/user', async (req, res) => {
  try {
    const supabase = req.app.locals.supabase;
    if (!supabase) {
      return res.status(503).json({ error: 'Database not configured' });
    }

    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const result = await authenticateUser(supabase, username, password);
    if (!result.success) {
      return res.status(401).json({ error: result.error });
    }

    // Single device enforcement — force-kick any existing sessions so this login wins
    const activeSessions = await getActiveSessions(`supabase:${result.user.id}`);
    if (activeSessions.length > 0) {
      console.log(`[Auth] Force-logging out ${activeSessions.length} existing session(s) for user ${result.user.id}`);
      for (const oldSessionId of activeSessions) {
        await redisClient.del(`sess:${oldSessionId}`);
      }
      await redisClient.del(`active_sessions:supabase:${result.user.id}`);
    }

    req.session.regenerate(async (err) => {
      if (err) {
        console.error('User session regenerate error:', err);
        return res.status(500).json({ error: 'Login failed (session error)' });
      }

      req.session.userId = result.user.username;
      req.session.supabaseId = result.user.id;
      req.session.role = 'user';
      req.session.adminId = result.user.adminId;
      req.session.adminName = result.user.adminName;
      req.session.credits = result.user.credits;
      req.session.permissions = result.user.permissions;
      req.session.ip = req.headers['x-forwarded-for'] || req.ip;
      req.session.userAgent = req.headers['user-agent'] || '';
      req.session.loginAt = Date.now();

      await addActiveSession(`supabase:${result.user.id}`, req.sessionID);

      await logAudit(supabase, {
        actorType: 'user',
        actorId: result.user.id,
        action: 'login',
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });

      return req.session.save((err) => {
        if (err) {
          console.error('User session save error:', err);
          return res.status(500).json({ error: 'Login failed (session error)' });
        }
        return res.json({ ok: true, role: 'user', user: result.user });
      });
    });
  } catch (e) {
    console.error('User login error:', e);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/logout - Logout current user
 */
router.post('/logout', async (req, res) => {
  const userId = req.session?.userId;
  const sessionId = req.sessionID;
  const supabaseId = req.session?.supabaseId;

  // Remove from active sessions
  if (supabaseId && sessionId) {
    await removeActiveSession(`supabase:${supabaseId}`, sessionId);
  }

  // Clean up session data
  if (sessionId) {
    try {
      await deleteSessionData(sessionId);
    } catch (e) {
      console.warn('Logout cleanup error:', e);
    }
  }

  req.session.destroy(() => res.json({ ok: true }));
});

/**
 * GET /api/me - Get current user info (supports all roles)
 */
router.get('/me', async (req, res) => {
  if (!req.session?.userId) {
    return res.status(401).json({ error: 'Not logged in' });
  }

  const role = req.session.role || 'user';
  const supabase = req.app.locals.supabase;

  // Super Admin — no DB lookup needed
  if (role === 'super_admin') {
    return res.json({
      userId: req.session.userId,
      role: 'super_admin',
      credits: 0,
      unlimitedCredits: true,
      permissions: { canExpand: true, canAnalyze: true, canReasoning: true, canTurbo: true, canStartSession: true },
      lockedFeatures: {},
    });
  }

  // Admin — fetch from admins table
  if (role === 'admin') {
    let credits = req.session.credits || 0;
    let adminPerms = {};

    if (supabase && req.session.supabaseId) {
      const { data } = await supabase
        .from('admins')
        .select('credits, permissions, name')
        .eq('id', req.session.supabaseId)
        .single();
      if (data) {
        credits = data.credits;
        adminPerms = data.permissions || {};
      }
    }

    const { permissions, lockedFeatures } = resolveAdminPermissions(adminPerms);

    return res.json({
      userId: req.session.userId,
      role: 'admin',
      supabaseId: req.session.supabaseId,
      adminName: req.session.adminName,
      credits,
      permissions,
      lockedFeatures,
    });
  }

  // User — existing logic
  let credits = req.session.credits || 0;
  let userPerms = req.session.permissions || {};
  let adminPerms = {};

  if (supabase && req.session.supabaseId) {
    const { data } = await supabase
      .from('users')
      .select('credits, permissions, admin_id')
      .eq('id', req.session.supabaseId)
      .single();
    if (data) {
      credits = data.credits;
      userPerms = data.permissions || userPerms;

      // Fetch admin permissions to check for admin-level locks
      if (data.admin_id) {
        const { data: adminData } = await supabase
          .from('admins')
          .select('permissions')
          .eq('id', data.admin_id)
          .single();
        if (adminData) adminPerms = adminData.permissions || {};
      }
    }
  }

  // Resolve final permissions + locked features (respects admin locks)
  const { permissions, lockedFeatures } = resolveUserPermissions(userPerms, adminPerms);

  return res.json({
    userId: req.session.userId,
    role: 'user',
    supabaseId: req.session.supabaseId,
    adminId: req.session.adminId,
    adminName: req.session.adminName,
    credits,
    permissions,
    lockedFeatures,
  });
});

export default router;
