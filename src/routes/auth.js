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
import { checkLoginLockout, recordLoginFailure, clearLoginFailures } from '../middleware/rateLimit.js';
import { getActiveSession, endSession } from '../services/credits.js';

// Shared message shown on the device that gets kicked by a newer login.
const KICKED_MESSAGE = 'You have been signed out because your account was signed in on another device.';

/**
 * Enforce single active session: delete any existing sessions for this account
 * and live-kick those devices (socket popup + redirect). Super admin never calls
 * this — the super admin may be signed in on multiple devices at once.
 */
async function enforceSingleDevice(req, supabaseId) {
  const activeSessions = await getActiveSessions(`supabase:${supabaseId}`);
  if (!activeSessions.length) return;
  console.log(`[Auth] Single-device: kicking ${activeSessions.length} old session(s) for ${supabaseId}`);
  // Live popup on the old device(s) before their session is destroyed.
  try {
    req.app.locals.kickSessions?.(activeSessions, KICKED_MESSAGE);
  } catch (e) {
    console.warn('[Auth] kickSessions failed:', e?.message);
  }
  for (const oldSessionId of activeSessions) {
    await redisClient.del(`sess:${oldSessionId}`);
  }
  await redisClient.del(`active_sessions:supabase:${supabaseId}`);
}

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

    // Brute-force lockout (100 failed tries per IP or username). Super admin is
    // exempt — this only guards the admin login.
    const adminIp = req.headers['x-forwarded-for'] || req.ip;
    const adminLockKeys = [`ip:admin:${adminIp}`, `name:admin:${username}`];
    const adminLock = await checkLoginLockout(adminLockKeys);
    if (!adminLock.allowed) {
      return res.status(429).json({ error: adminLock.error });
    }

    const result = await authenticateAdmin(supabase, username, password);
    if (!result.success) {
      await recordLoginFailure(adminLockKeys);
      return res.status(401).json({ error: result.error });
    }
    await clearLoginFailures(adminLockKeys);

    // Single-device: kick any older admin session (live popup + redirect).
    await enforceSingleDevice(req, result.user.id);

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

    const { username, password, orgCode } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    // Organization code is required for user login. Usernames are only unique
    // WITHIN an organization, so the code tells us which org to sign into and
    // removes cross-organization ambiguity.
    const normalizedOrgCode = (orgCode || '').toString().trim().toUpperCase();
    if (!normalizedOrgCode) {
      return res.status(400).json({ error: 'Organization code is required' });
    }

    // Brute-force lockout (100 failed tries per IP or username). Super admin is
    // exempt — this only guards the user login.
    const userIp = req.headers['x-forwarded-for'] || req.ip;
    const userLockKeys = [`ip:user:${userIp}`, `name:user:${username}`];
    const userLock = await checkLoginLockout(userLockKeys);
    if (!userLock.allowed) {
      return res.status(429).json({ error: userLock.error });
    }

    // Resolve the org code → the admin/organization it belongs to.
    const { data: org } = await supabase
      .from('admins')
      .select('id')
      .eq('org_code', normalizedOrgCode)
      .maybeSingle();
    if (!org) {
      await recordLoginFailure(userLockKeys);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Scope the login to that organization.
    const result = await authenticateUser(supabase, username, password, org.id);
    if (!result.success) {
      await recordLoginFailure(userLockKeys);
      return res.status(401).json({ error: result.error });
    }
    await clearLoginFailures(userLockKeys);

    // Single-device: kick any older session for this user (live popup + redirect).
    await enforceSingleDevice(req, result.user.id);

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
  const sessionId = req.sessionID;
  const supabaseId = req.session?.supabaseId;
  const role = req.session?.role;
  const supabase = req.app.locals.supabase;

  // Finalize (end + bill) any active interview session on explicit logout, so
  // credits are charged for the real time used. Super admin has no session rows
  // and is never billed, so it is skipped.
  if (supabase && supabaseId && (role === 'user' || role === 'admin')) {
    try {
      const active = await getActiveSession(supabase, supabaseId, role);
      if (active) await endSession(supabase, active.id);
    } catch (e) {
      console.warn('[Logout] end session failed:', e?.message);
    }
  }

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
    let orgCode = null;

    if (supabase && req.session.supabaseId) {
      const { data } = await supabase
        .from('admins')
        .select('credits, permissions, name, org_code')
        .eq('id', req.session.supabaseId)
        .single();
      if (data) {
        credits = data.credits;
        adminPerms = data.permissions || {};
        orgCode = data.org_code || null;
      }
    }

    const { permissions, lockedFeatures } = resolveAdminPermissions(adminPerms);

    return res.json({
      userId: req.session.userId,
      role: 'admin',
      supabaseId: req.session.supabaseId,
      adminName: req.session.adminName,
      orgCode,
      credits,
      permissions,
      lockedFeatures,
    });
  }

  // User — existing logic
  let credits = req.session.credits || 0;
  let userPerms = req.session.permissions || {};
  let adminPerms = {};
  let orgCode = null;

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
          .select('permissions, org_code')
          .eq('id', data.admin_id)
          .single();
        if (adminData) {
          adminPerms = adminData.permissions || {};
          orgCode = adminData.org_code || null;
        }
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
    orgCode,
    credits,
    permissions,
    lockedFeatures,
  });
});

export default router;
