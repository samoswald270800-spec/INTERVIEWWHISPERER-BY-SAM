/**
 * Super Admin API Routes
 * All routes require super_admin role
 * ALL USE USERNAME (not email)
 */

import express from 'express';
import {
  createAdmin,
  hashPassword,
  logAudit,
} from '../services/auth.js';
import {
  addCreditsToAdmin,
  deductCreditsFromAdmin,
} from '../services/credits.js';

const router = express.Router();

/**
 * Middleware: Require Super Admin
 */
function requireSuperAdmin(req, res, next) {
  if (req.session?.role !== 'super_admin') {
    return res.status(403).json({ error: 'Super Admin access required' });
  }
  next();
}

router.use(requireSuperAdmin);

/**
 * GET /api/super-admin/stats
 */
router.get('/stats', async (req, res) => {
  try {
    const { supabase } = req.app.locals;

    const { count: adminCount } = await supabase
      .from('admins')
      .select('*', { count: 'exact', head: true });

    const { count: userCount } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true });

    const today = new Date().toISOString().split('T')[0];
    const { count: sessionsToday } = await supabase
      .from('sessions')
      .select('*', { count: 'exact', head: true })
      .gte('start_time', today);

    const { data: admins } = await supabase.from('admins').select('credits');
    const totalAdminCredits = admins?.reduce((sum, a) => sum + (a.credits || 0), 0) || 0;

    res.json({
      ok: true,
      stats: {
        totalAdmins: adminCount || 0,
        totalUsers: userCount || 0,
        sessionsToday: sessionsToday || 0,
        totalAdminCredits,
      }
    });
  } catch (e) {
    console.error('[Super Admin Stats]', e);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

/**
 * GET /api/super-admin/admins
 */
router.get('/admins', async (req, res) => {
  try {
    const { supabase } = req.app.locals;

    const { data: admins, error } = await supabase
      .from('admins')
      .select('id, name, username, credits, status, created_at, last_login')
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Get user counts
    const adminIds = admins.map(a => a.id);
    const { data: userCounts } = await supabase
      .from('users')
      .select('admin_id')
      .in('admin_id', adminIds);

    const countMap = {};
    userCounts?.forEach(u => {
      countMap[u.admin_id] = (countMap[u.admin_id] || 0) + 1;
    });

    const adminsWithCounts = admins.map(a => ({
      ...a,
      userCount: countMap[a.id] || 0,
    }));

    res.json({ ok: true, admins: adminsWithCounts });
  } catch (e) {
    console.error('[Super Admin List Admins]', e);
    res.status(500).json({ error: 'Failed to fetch admins' });
  }
});

/**
 * GET /api/super-admin/admins/:id/users
 * Get all users under a specific admin (expandable view)
 */
router.get('/admins/:id/users', async (req, res) => {
  try {
    const { supabase } = req.app.locals;
    const { id } = req.params;

    const { data: users, error } = await supabase
      .from('users')
      .select('id, username, credits, status, permissions, created_at, last_login')
      .eq('admin_id', id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json({ ok: true, users: users || [] });
  } catch (e) {
    console.error('[Super Admin Get Admin Users]', e);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

/**
 * POST /api/super-admin/admins
 */
router.post('/admins', async (req, res) => {
  try {
    const { supabase } = req.app.locals;
    const { name, username, password, credits = 0 } = req.body;

    if (!name || !username || !password) {
      return res.status(400).json({ error: 'name, username, and password are required' });
    }

    const result = await createAdmin(supabase, {
      name,
      username,
      password,
      credits,
    });

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    await logAudit(supabase, {
      actorType: 'super_admin',
      actorId: 'super-admin',
      action: 'create_admin',
      targetType: 'admin',
      targetId: result.admin.id,
      details: { name, username, credits },
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.json({ ok: true, admin: result.admin });
  } catch (e) {
    console.error('[Super Admin Create Admin]', e);
    res.status(500).json({ error: 'Failed to create admin' });
  }
});

/**
 * DELETE /api/super-admin/admins/:id
 * Delete admin and force logout all their users
 */
router.delete('/admins/:id', async (req, res) => {
  try {
    const { supabase, forceLogoutAdmin, forceLogoutAllUsersUnderAdmin } = req.app.locals;
    const { id } = req.params;

    // Force logout the admin
    await forceLogoutAdmin(id);

    // Force logout all users under this admin
    await forceLogoutAllUsersUnderAdmin(supabase, id);

    // Delete admin (cascade deletes users)
    const { error } = await supabase.from('admins').delete().eq('id', id);
    if (error) throw error;

    await logAudit(supabase, {
      actorType: 'super_admin',
      actorId: 'super-admin',
      action: 'delete_admin',
      targetType: 'admin',
      targetId: id,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.json({ ok: true });
  } catch (e) {
    console.error('[Super Admin Delete Admin]', e);
    res.status(500).json({ error: 'Failed to delete admin' });
  }
});

/**
 * POST /api/super-admin/admins/:id/force-logout
 * Force logout an admin
 */
router.post('/admins/:id/force-logout', async (req, res) => {
  try {
    const { forceLogoutAdmin } = req.app.locals;
    const { id } = req.params;

    const count = await forceLogoutAdmin(id);

    res.json({ ok: true, sessionsTerminated: count });
  } catch (e) {
    console.error('[Super Admin Force Logout Admin]', e);
    res.status(500).json({ error: 'Failed to force logout' });
  }
});

/**
 * POST /api/super-admin/users/:id/force-logout
 * Force logout a user (Super Admin can logout any user)
 */
router.post('/users/:id/force-logout', async (req, res) => {
  try {
    const { forceLogoutUser } = req.app.locals;
    const { id } = req.params;

    const count = await forceLogoutUser(id);

    res.json({ ok: true, sessionsTerminated: count });
  } catch (e) {
    console.error('[Super Admin Force Logout User]', e);
    res.status(500).json({ error: 'Failed to force logout' });
  }
});

/**
 * PATCH /api/super-admin/users/:id/permissions
 * Update user permissions (Super Admin can update any user)
 */
router.patch('/users/:id/permissions', async (req, res) => {
  try {
    const { supabase } = req.app.locals;
    const { id } = req.params;
    const { permissions } = req.body;

    if (!permissions) {
      return res.status(400).json({ error: 'permissions object required' });
    }

    const { data: user, error: fetchError } = await supabase
      .from('users')
      .select('permissions')
      .eq('id', id)
      .single();

    if (fetchError || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const newPermissions = { ...user.permissions, ...permissions };

    const { error } = await supabase
      .from('users')
      .update({ permissions: newPermissions })
      .eq('id', id);

    if (error) throw error;

    res.json({ ok: true, permissions: newPermissions });
  } catch (e) {
    console.error('[Super Admin Update User Permissions]', e);
    res.status(500).json({ error: 'Failed to update permissions' });
  }
});

/**
 * POST /api/super-admin/admins/:id/credits
 */
router.post('/admins/:id/credits', async (req, res) => {
  try {
    const { supabase } = req.app.locals;
    const { id } = req.params;
    const { amount, description } = req.body;

    if (typeof amount !== 'number' || amount === 0) {
      return res.status(400).json({ error: 'amount must be a non-zero number' });
    }

    let result;
    if (amount > 0) {
      result = await addCreditsToAdmin(supabase, { adminId: id, amount, description });
    } else {
      result = await deductCreditsFromAdmin(supabase, { adminId: id, amount: Math.abs(amount), description });
    }

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json({ ok: true, newCredits: result.newCredits });
  } catch (e) {
    console.error('[Super Admin Modify Credits]', e);
    res.status(500).json({ error: 'Failed to modify credits' });
  }
});

/**
 * GET /api/super-admin/users
 */
router.get('/users', async (req, res) => {
  try {
    const { supabase } = req.app.locals;

    const { data: users, error } = await supabase
      .from('users')
      .select('*, admins(id, name)')
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json({ ok: true, users });
  } catch (e) {
    console.error('[Super Admin List Users]', e);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

/**
 * GET /api/super-admin/sessions
 */
router.get('/sessions', async (req, res) => {
  try {
    const { supabase } = req.app.locals;
    const limit = parseInt(req.query.limit) || 100;

    const { data: sessions, error } = await supabase
      .from('sessions')
      .select('*, users(username), admins(name)')
      .order('start_time', { ascending: false })
      .limit(limit);

    if (error) throw error;

    res.json({ ok: true, sessions });
  } catch (e) {
    console.error('[Super Admin Sessions]', e);
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

/**
 * GET /api/super-admin/audit-logs
 */
router.get('/audit-logs', async (req, res) => {
  try {
    const { supabase } = req.app.locals;
    const limit = parseInt(req.query.limit) || 100;

    const { data: logs, error } = await supabase
      .from('audit_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;

    res.json({ ok: true, logs });
  } catch (e) {
    console.error('[Super Admin Audit Logs]', e);
    res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
});

export default router;
