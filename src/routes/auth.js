/**
 * Authentication Routes
 * Desktop App - User Authentication Only
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
import { authenticateUser, logAudit } from '../services/auth.js';

const router = express.Router();

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
 * GET /api/me - Get current user info
 */
router.get('/me', async (req, res) => {
  if (!req.session?.userId) {
    return res.status(401).json({ error: 'Not logged in' });
  }

  const supabase = req.app.locals.supabase;

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
    userId: req.session.userId,
    role: req.session.role || 'user',
    supabaseId: req.session.supabaseId,
    adminId: req.session.adminId,
    adminName: req.session.adminName,
    credits,
    permissions,
  });
});

export default router;
