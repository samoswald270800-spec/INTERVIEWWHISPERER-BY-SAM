/**
 * Admin (Consultancy) API Routes
 * All routes require admin role
 * ALL USE USERNAME (not email)
 */

import express from 'express';
import {
  createUser,
  updateUserPermissions,
  hashPassword,
  logAudit,
} from '../services/auth.js';
import {
  assignCreditsToUser,
  reclaimCreditsFromUser,
  getAdminCreditHistory,
  getAdminSessionHistory,
} from '../services/credits.js';

const router = express.Router();

/**
 * Middleware: Require Admin
 */
function requireAdmin(req, res, next) {
  if (req.session?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

router.use(requireAdmin);

/**
 * GET /api/admin/stats
 */
router.get('/stats', async (req, res) => {
  try {
    const { supabase } = req.app.locals;
    const adminId = req.session.supabaseId;

    const { data: admin } = await supabase
      .from('admins')
      .select('credits, name')
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
      .select('*')
      .eq('admin_id', adminId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Get session counts
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
      password_hash: undefined,
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

    // Check admin has enough credits
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

    // Assign credits if requested
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

    // Force logout the user
    await forceLogoutUser(id);

    // Return credits to admin
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
 * POST /api/admin/users/:id/force-logout
 * Force logout a user
 */
router.post('/users/:id/force-logout', async (req, res) => {
  try {
    const { supabase, forceLogoutUser } = req.app.locals;
    const adminId = req.session.supabaseId;
    const { id } = req.params;

    // Verify user belongs to this admin
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

    const { data: existingUser } = await supabase
      .from('users')
      .select('permissions')
      .eq('id', id)
      .eq('admin_id', adminId)
      .single();

    if (!existingUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    const newPermissions = { ...existingUser.permissions, ...permissions };
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

    const result = await assignCreditsToUser(supabase, {
      userId: id,
      adminId,
      amount,
      description,
    });

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

    const result = await reclaimCreditsFromUser(supabase, {
      userId: id,
      adminId,
      amount,
      description,
    });

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
