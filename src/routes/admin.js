/**
 * Admin (Consultancy) API Routes
 * All routes require admin role
 * ALL USE USERNAME (not email)
 */

import express from 'express';
import { requireConsultancyAdmin } from '../middleware/auth.js';
import { redisClient, removeActiveSession } from '../lib/redis.js';
import {
  createUser,
  updateUserPermissions,
  logAudit,
} from '../services/auth.js';
import {
  assignCreditsToUser,
  reclaimCreditsFromUser,
  getAdminCreditHistory,
  getAdminSessionHistory,
} from '../services/credits.js';

const router = express.Router();

router.use(requireConsultancyAdmin);

/**
 * GET /api/admin/stats
 */
router.get('/stats', async (req, res) => {
  try {
    const { supabase } = req.app.locals;
    const adminId = req.session.supabaseId;

    const { data: admin } = await supabase
      .from('admins')
      .select('credits, name, org_code')
      .eq('id', adminId)
      .single();

    const { count: userCount } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true })
      .eq('admin_id', adminId);

    const { count: activeUsers } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true })
      .eq('admin_id', adminId)
      .eq('status', 'active');

    const today = new Date().toISOString().split('T')[0];
    const { count: sessionsToday } = await supabase
      .from('sessions')
      .select('*', { count: 'exact', head: true })
      .eq('admin_id', adminId)
      .gte('start_time', today);

    const { data: todayTransactions } = await supabase
      .from('credit_transactions')
      .select('amount')
      .eq('admin_id', adminId)
      .eq('type', 'consume')
      .gte('created_at', today);

    const creditsUsedToday = todayTransactions?.reduce((sum, t) => sum + Math.abs(t.amount), 0) || 0;

    res.json({
      ok: true,
      stats: {
        adminName: admin?.name,
        orgCode: admin?.org_code || null,
        credits: admin?.credits || 0,
        totalUsers: userCount || 0,
        activeUsers: activeUsers || 0,
        sessionsToday: sessionsToday || 0,
        creditsUsedToday,
      }
    });
  } catch (e) {
    console.error('[Admin Stats]', e);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

/**
 * GET /api/admin/users
 */
router.get('/users', async (req, res) => {
  try {
    const { supabase } = req.app.locals;
    const adminId = req.session.supabaseId;

    const { data: users, error } = await supabase
      .from('users')
      .select('id, username, credits, status, permissions, created_at, last_login, admin_id')
      .eq('admin_id', adminId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const userIds = users.map(u => u.id);
    const { data: sessionCounts } = await supabase
      .from('sessions')
      .select('user_id')
      .in('user_id', userIds);

    const countMap = {};
    sessionCounts?.forEach(s => {
      countMap[s.user_id] = (countMap[s.user_id] || 0) + 1;
    });

    const usersWithCounts = users.map(u => ({
      ...u,
      sessionCount: countMap[u.id] || 0,
    }));

    res.json({ ok: true, users: usersWithCounts });
  } catch (e) {
    console.error('[Admin List Users]', e);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

/**
 * POST /api/admin/users
 */
router.post('/users', async (req, res) => {
  try {
    const { supabase } = req.app.locals;
    const adminId = req.session.supabaseId;
    const { username, password, credits = 0, permissions = { canExpand: true, canAnalyze: true } } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'username and password are required' });
    }

    const { data: admin } = await supabase
      .from('admins')
      .select('credits')
      .eq('id', adminId)
      .single();

    if (credits > 0 && admin.credits < credits) {
      return res.status(400).json({ error: 'Insufficient credits to assign to user' });
    }

    const result = await createUser(supabase, {
      username,
      password,
      credits: 0,
      permissions,
      adminId,
    });

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    if (credits > 0) {
      await assignCreditsToUser(supabase, {
        userId: result.user.id,
        adminId,
        amount: credits,
        description: 'Initial credit assignment',
      });
      result.user.credits = credits;
    }

    await logAudit(supabase, {
      actorType: 'admin',
      actorId: adminId,
      action: 'create_user',
      targetType: 'user',
      targetId: result.user.id,
      details: { username, credits, permissions },
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.json({ ok: true, user: result.user });
  } catch (e) {
    console.error('[Admin Create User]', e);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

/**
 * DELETE /api/admin/users/:id
 */
router.delete('/users/:id', async (req, res) => {
  try {
    const { supabase, forceLogoutUser } = req.app.locals;
    const adminId = req.session.supabaseId;
    const { id } = req.params;

    const { data: user } = await supabase
      .from('users')
      .select('credits')
      .eq('id', id)
      .eq('admin_id', adminId)
      .single();

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    await forceLogoutUser(id);

    if (user.credits > 0) {
      await reclaimCreditsFromUser(supabase, {
        userId: id,
        adminId,
        amount: user.credits,
        description: 'User deleted - credits returned',
      });
    }

    const { error } = await supabase.from('users').delete().eq('id', id);
    if (error) throw error;

    await logAudit(supabase, {
      actorType: 'admin',
      actorId: adminId,
      action: 'delete_user',
      targetType: 'user',
      targetId: id,
      details: { creditsReturned: user.credits },
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.json({ ok: true, creditsReturned: user.credits });
  } catch (e) {
    console.error('[Admin Delete User]', e);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

/**
 * PATCH /api/admin/users/:id/status
 */
router.patch('/users/:id/status', async (req, res) => {
  try {
    const { supabase, forceLogoutUser } = req.app.locals;
    const adminId = req.session.supabaseId;
    const { id } = req.params;
    const { status } = req.body;

    if (!['active', 'suspended'].includes(status)) {
      return res.status(400).json({ error: 'status must be active or suspended' });
    }

    const { data: user } = await supabase
      .from('users')
      .select('id')
      .eq('id', id)
      .eq('admin_id', adminId)
      .single();

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { error } = await supabase.from('users').update({ status }).eq('id', id);
    if (error) throw error;

    if (status === 'suspended') {
      await forceLogoutUser(id);
    }

    await logAudit(supabase, {
      actorType: 'admin',
      actorId: adminId,
      action: 'update_user_status',
      targetType: 'user',
      targetId: id,
      details: { status },
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.json({ ok: true, status });
  } catch (e) {
    console.error('[Admin Update User Status]', e);
    res.status(500).json({ error: 'Failed to update status' });
  }
});

/**
 * POST /api/admin/users/:id/force-logout
 */
router.post('/users/:id/force-logout', async (req, res) => {
  try {
    const { supabase, forceLogoutUser } = req.app.locals;
    const adminId = req.session.supabaseId;
    const { id } = req.params;

    const { data: user } = await supabase
      .from('users')
      .select('id')
      .eq('id', id)
      .eq('admin_id', adminId)
      .single();

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const count = await forceLogoutUser(id);

    res.json({ ok: true, sessionsTerminated: count });
  } catch (e) {
    console.error('[Admin Force Logout User]', e);
    res.status(500).json({ error: 'Failed to force logout' });
  }
});

/**
 * PATCH /api/admin/users/:id/permissions
 */
router.patch('/users/:id/permissions', async (req, res) => {
  try {
    const { supabase } = req.app.locals;
    const adminId = req.session.supabaseId;
    const { id } = req.params;
    const { permissions } = req.body;

    if (!permissions || typeof permissions !== 'object') {
      return res.status(400).json({ error: 'permissions object required' });
    }

    // Check which features are SA-locked on this admin — admin can't override those
    const { data: adminData } = await supabase
      .from('admins')
      .select('permissions')
      .eq('id', adminId)
      .single();

    const adminLocks = adminData?.permissions?.superAdminLocks || {};

    // Also check user-level SA locks
    const { data: userData } = await supabase
      .from('users')
      .select('permissions')
      .eq('id', id)
      .eq('admin_id', adminId)
      .single();

    const userLocks = userData?.permissions?.superAdminLocks || {};

    // Strip any keys that are SA-locked (admin can't toggle them)
    const filteredPermissions = { ...permissions };
    for (const key of Object.keys(filteredPermissions)) {
      if (adminLocks[key] === false || userLocks[key] === false) {
        delete filteredPermissions[key];
      }
    }

    const { data: existingUser } = await supabase
      .from('users')
      .select('permissions')
      .eq('id', id)
      .eq('admin_id', adminId)
      .single();

    if (!existingUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Preserve superAdminLocks — admin must never overwrite them
    const newPermissions = { ...existingUser.permissions, ...filteredPermissions };
    if (existingUser.permissions?.superAdminLocks) {
      newPermissions.superAdminLocks = existingUser.permissions.superAdminLocks;
    }
    const result = await updateUserPermissions(supabase, id, newPermissions);

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    await logAudit(supabase, {
      actorType: 'admin',
      actorId: adminId,
      action: 'update_permissions',
      targetType: 'user',
      targetId: id,
      details: { permissions: newPermissions },
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.json({ ok: true, user: { ...result.user, password_hash: undefined } });
  } catch (e) {
    console.error('[Admin Update Permissions]', e);
    res.status(500).json({ error: 'Failed to update permissions' });
  }
});

/**
 * POST /api/admin/users/:id/credits/assign
 */
router.post('/users/:id/credits/assign', async (req, res) => {
  try {
    const { supabase } = req.app.locals;
    const adminId = req.session.supabaseId;
    const { id } = req.params;
    const { amount, description } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'amount must be positive' });
    }

    const result = await assignCreditsToUser(supabase, { userId: id, adminId, amount, description });

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json({ ok: true, adminCredits: result.adminCredits, userCredits: result.userCredits });
  } catch (e) {
    console.error('[Admin Assign Credits]', e);
    res.status(500).json({ error: 'Failed to assign credits' });
  }
});

/**
 * POST /api/admin/users/:id/credits/reclaim
 */
router.post('/users/:id/credits/reclaim', async (req, res) => {
  try {
    const { supabase } = req.app.locals;
    const adminId = req.session.supabaseId;
    const { id } = req.params;
    const { amount, description } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'amount must be positive' });
    }

    const result = await reclaimCreditsFromUser(supabase, { userId: id, adminId, amount, description });

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json({ ok: true, adminCredits: result.adminCredits, userCredits: result.userCredits, reclaimedAmount: result.reclaimedAmount });
  } catch (e) {
    console.error('[Admin Reclaim Credits]', e);
    res.status(500).json({ error: 'Failed to reclaim credits' });
  }
});

/**
 * POST /api/admin/sessions/:sessionId/logout
 * Force logout a specific session
 */
router.post('/sessions/:sessionId/logout', async (req, res) => {
  try {
    const { sessionId } = req.params;
    if (!sessionId) return res.status(400).json({ error: 'Missing sessionId' });

    const key = `sess:${sessionId}`;

    // FIX: Retrieve userId before deletion to clean up active_sessions
    const raw = await redisClient.get(key);
    let userId = null;
    if (raw) {
      try {
        const data = JSON.parse(raw);
        userId = data.userId || data.user;
      } catch (e) {}
    }

    // Check existence
    const exists = await redisClient.exists(key);
    if (!exists) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Remove the session key (destroy session)
    await redisClient.del(key);

    // FIX: Remove from active_sessions set
    if (userId) {
      await removeActiveSession(userId, sessionId);
    }

    res.json({ ok: true });
  } catch (e) {
    console.error('[Admin Force Logout Session]', e);
    res.status(500).json({ error: 'Failed to logout session' });
  }
});

/**
 * GET /api/admin/sessions
 */
router.get('/sessions', async (req, res) => {
  try {
    const { supabase } = req.app.locals;
    const adminId = req.session.supabaseId;

    const result = await getAdminSessionHistory(supabase, adminId, 100);

    if (!result.success) {
      return res.status(500).json({ error: result.error });
    }

    res.json({ ok: true, sessions: result.sessions });
  } catch (e) {
    console.error('[Admin Sessions]', e);
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

/**
 * GET /api/admin/credit-history
 */
router.get('/credit-history', async (req, res) => {
  try {
    const { supabase } = req.app.locals;
    const adminId = req.session.supabaseId;

    const result = await getAdminCreditHistory(supabase, adminId, 100);

    if (!result.success) {
      return res.status(500).json({ error: result.error });
    }

    res.json({ ok: true, transactions: result.transactions });
  } catch (e) {
    console.error('[Admin Credit History]', e);
    res.status(500).json({ error: 'Failed to fetch credit history' });
  }
});

export default router;

