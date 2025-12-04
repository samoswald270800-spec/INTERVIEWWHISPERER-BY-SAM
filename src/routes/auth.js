/**
 * Authentication Routes
 * Handles login/logout for all user types
 */

import express from 'express';
import config from '../config/index.js';
import { getDeviceFingerprint } from '../middleware/session.js';
import {
  addActiveSession,
  removeActiveSession,
  getActiveSessions,
  deleteSessionData,
  redisClient,
} from '../lib/redis.js';
import {
  authenticateSuperAdmin,
  authenticateAdmin,
  authenticateUser,
  logAudit,
} from '../services/auth.js';

const router = express.Router();

// Legacy temp user prefix (for backward compatibility)
const TEMP_USER_PREFIX = 'tempuser:';

/**
 * POST /api/login - Legacy unified login (Admin + Temp User)
 */
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    // 1. Check Legacy Admin Credentials
    if (username === config.ADMIN_USER && password === config.ADMIN_PASS) {
      req.session.userId = username;
      req.session.role = 'admin';
      req.session.ip = req.headers['x-forwarded-for'] || req.ip;
      req.session.userAgent = req.headers['user-agent'] || '';
      req.session.deviceFingerprint = getDeviceFingerprint(req);
      req.session.loginAt = Date.now();

      return req.session.save((err) => {
        if (err) {
          console.error('Admin session save error:', err);
          return res.status(500).json({ error: 'Session error' });
        }
        return res.json({ ok: true, role: 'admin' });
      });
    }

    // 2. Check Temp User Credentials (Redis)
    const key = `${TEMP_USER_PREFIX}${username}`;
    const raw = await redisClient.get(key);

    if (!raw) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return res.status(401).json({ error: 'Account data error' });
    }

    if (data.password !== password) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // 3. Single device enforcement
    const activeSessions = await getActiveSessions(username);
    if (activeSessions.length > 0) {
      const currentIp = (req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
      let activeOnOtherDevice = false;

      for (const sid of activeSessions) {
        const sRaw = await redisClient.get(`sess:${sid}`);
        if (sRaw) {
          try {
            const s = JSON.parse(sRaw);
            const sIp = (s.ip || '').split(',')[0].trim();
            if (sIp && sIp !== currentIp) {
              activeOnOtherDevice = true;
              break;
            }
          } catch (e) { /* ignore */ }
        }
      }

      if (activeOnOtherDevice) {
        return res.status(403).json({
          error: 'Account is active on another device. Please logout there first.'
        });
      }

      // Same IP -> Kick out old sessions
      console.log(`[Login] Re-login from same IP. Cleaning up ${activeSessions.length} old sessions for ${username}`);
      for (const oldSessionId of activeSessions) {
        await redisClient.del(`sess:${oldSessionId}`);
      }
      await redisClient.del(`active_sessions:${username}`);
    }

    // 4. Success: Create New Session
    req.session.regenerate(async (err) => {
      if (err) {
        console.error('Session regenerate error:', err);
        return res.status(500).json({ error: 'Login failed (session error)' });
      }

      req.session.userId = username;
      req.session.role = 'user';
      req.session.permissions = data.permissions || { canExpand: true, canAnalyze: true };
      req.session.ip = req.headers['x-forwarded-for'] || req.ip;
      req.session.userAgent = req.headers['user-agent'] || '';
      req.session.deviceFingerprint = getDeviceFingerprint(req);
      req.session.loginAt = Date.now();

      await addActiveSession(username, req.sessionID);

      return req.session.save((err) => {
        if (err) {
          console.error('User session save error:', err);
          return res.status(500).json({ error: 'Login failed (session error)' });
        }
        console.log(`[Login] Success for ${username}. SessionID: ${req.sessionID} saved.`);
        return res.json({ ok: true, role: 'user', permissions: req.session.permissions });
      });
    });

  } catch (e) {
    console.error('Login handler error:', e);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/auth/super-admin - Super Admin login (easter egg)
 */
router.post('/auth/super-admin', async (req, res) => {
  try {
    const supabase = req.app.locals.supabase;
    if (!supabase) {
      return res.status(503).json({ error: 'Multi-tenant system not configured' });
    }

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

    await logAudit(supabase, {
      actorType: 'super_admin',
      actorId: result.user.id,
      action: 'login',
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return req.session.save((err) => {
      if (err) {
        console.error('Super Admin session save error:', err);
        return res.status(500).json({ error: 'Session error' });
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
      return res.status(503).json({ error: 'Multi-tenant system not configured' });
    }

    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const result = await authenticateAdmin(supabase, username, password);
    if (!result.success) {
      return res.status(401).json({ error: result.error });
    }

    req.session.userId = result.user.username;
    req.session.supabaseId = result.user.id;
    req.session.role = 'admin';
    req.session.credits = result.user.credits;
    req.session.adminName = result.user.name;
    req.session.ip = req.headers['x-forwarded-for'] || req.ip;
    req.session.userAgent = req.headers['user-agent'] || '';
    req.session.loginAt = Date.now();

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
        return res.status(500).json({ error: 'Session error' });
      }
      return res.json({ ok: true, role: 'admin', user: result.user });
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
      return res.status(503).json({ error: 'Multi-tenant system not configured' });
    }

    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const result = await authenticateUser(supabase, username, password);
    if (!result.success) {
      return res.status(401).json({ error: result.error });
    }

    // Single device enforcement
    const activeSessions = await getActiveSessions(`supabase:${result.user.id}`);
    if (activeSessions.length > 0) {
      const currentIp = (req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
      let activeOnOtherDevice = false;

      for (const sid of activeSessions) {
        const sRaw = await redisClient.get(`sess:${sid}`);
        if (sRaw) {
          try {
            const s = JSON.parse(sRaw);
            const sIp = (s.ip || '').split(',')[0].trim();
            if (sIp && sIp !== currentIp) {
              activeOnOtherDevice = true;
              break;
            }
          } catch (e) { /* ignore */ }
        }
      }

      if (activeOnOtherDevice) {
        return res.status(403).json({
          error: 'Account is active on another device. Please logout there first.'
        });
      }

      // Same IP -> Kick out old sessions
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
  const role = req.session?.role;

  // Remove from active sessions
  if (userId && sessionId && role !== 'admin') {
    await removeActiveSession(userId, sessionId);
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
 * GET /api/me - Get current user info
 */
router.get('/me', async (req, res) => {
  if (!req.session?.userId) {
    return res.status(401).json({ error: 'Not logged in' });
  }

  const supabase = req.app.locals.supabase;
  const baseResponse = {
    userId: req.session.userId,
    role: req.session.role,
    supabaseId: req.session.supabaseId,
  };

  // Super Admin
  if (req.session.role === 'super_admin') {
    return res.json({
      ...baseResponse,
      permissions: { canExpand: true, canAnalyze: true },
      dashboardUrl: '/super-admin'
    });
  }

  // Admin (Consultancy)
  if (req.session.role === 'admin') {
    let credits = req.session.credits || 0;
    if (supabase && req.session.supabaseId) {
      const { data } = await supabase
        .from('admins')
        .select('credits')
        .eq('id', req.session.supabaseId)
        .single();
      if (data) credits = data.credits;
    }

    return res.json({
      ...baseResponse,
      adminName: req.session.adminName,
      credits,
      permissions: { canExpand: true, canAnalyze: true },
      dashboardUrl: '/admin-dashboard'
    });
  }

  // User (Candidate)
  if (req.session.role === 'user') {
    let credits = req.session.credits || 0;
    let permissions = req.session.permissions || { canExpand: true, canAnalyze: true };
    
    if (supabase && req.session.supabaseId) {
      const { data } = await supabase
        .from('users')
        .select('credits, permissions')
        .eq('id', req.session.supabaseId)
        .single();
      if (data) {
        credits = data.credits;
        permissions = data.permissions || permissions;
      }
    }

    return res.json({
      ...baseResponse,
      adminId: req.session.adminId,
      adminName: req.session.adminName,
      credits,
      permissions,
      dashboardUrl: '/user-dashboard'
    });
  }

  // Legacy temp user
  return res.json({
    userId: req.session.userId,
    role: req.session.role || 'user',
    permissions: req.session.permissions || { canExpand: true, canAnalyze: true }
  });
});

export default router;

