/**
 * Super Admin API Routes
 * All routes require super_admin role
 * ALL USE USERNAME (not email)
 */

import express from 'express';
import { requireSuperAdmin } from '../middleware/auth.js';
import {
  createAdmin,
  logAudit,
  hashPassword,
} from '../services/auth.js';
import {
  addCreditsToAdmin,
  deductCreditsFromAdmin,
} from '../services/credits.js';

const router = express.Router();

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

    const adminIds = admins.map(a => a.id);
    const { data: userCounts } = await supabase
      .from('users')
      .select('admin_id')
      .in('admin_id', adminIds);

    const countMap = {};
    userCounts?.forEach(u => {
      countMap[u.admin_id] = (countMap[u.admin_id] || 0) + 1;
    });

    // FIX: Add Session Counts
    const { data: sessionCounts } = await supabase
      .from('sessions')
      .select('admin_id');

    const sessionCountMap = {};
    sessionCounts?.forEach(s => {
      sessionCountMap[s.admin_id] = (sessionCountMap[s.admin_id] || 0) + 1;
    });

    const adminsWithCounts = admins.map(a => ({
      ...a,
      userCount: countMap[a.id] || 0,
      sessionCount: sessionCountMap[a.id] || 0, // Added session count
    }));

    res.json({ ok: true, admins: adminsWithCounts });
  } catch (e) {
    console.error('[Super Admin List Admins]', e);
    res.status(500).json({ error: 'Failed to fetch admins' });
  }
});

/**
 * GET /api/super-admin/admins/:id/users
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

    const result = await createAdmin(supabase, { name, username, password, credits });

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
 */
router.delete('/admins/:id', async (req, res) => {
  try {
    const { supabase, forceLogoutAdmin, forceLogoutAllUsersUnderAdmin } = req.app.locals;
    const { id } = req.params;

    await forceLogoutAdmin(id);
    await forceLogoutAllUsersUnderAdmin(supabase, id);

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
 * PATCH /api/super-admin/admins/:id/status
 */
router.patch('/admins/:id/status', async (req, res) => {
  try {
    const { supabase, forceLogoutAdmin, forceLogoutAllUsersUnderAdmin } = req.app.locals;
    const { id } = req.params;
    const { status } = req.body;

    if (!['active', 'suspended'].includes(status)) {
      return res.status(400).json({ error: 'status must be active or suspended' });
    }

    const { error } = await supabase.from('admins').update({ status }).eq('id', id);
    if (error) throw error;

    if (status === 'suspended') {
      await forceLogoutAdmin(id);
      await forceLogoutAllUsersUnderAdmin(supabase, id);
    }

    await logAudit(supabase, {
      actorType: 'super_admin',
      actorId: 'super-admin',
      action: 'update_admin_status',
      targetType: 'admin',
      targetId: id,
      details: { status },
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.json({ ok: true, status });
  } catch (e) {
    console.error('[Super Admin Update Admin Status]', e);
    res.status(500).json({ error: 'Failed to update status' });
  }
});

/**
 * POST /api/super-admin/admins/:id/force-logout
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
 * PATCH /api/super-admin/users/:id/status
 */
router.patch('/users/:id/status', async (req, res) => {
  try {
    const { supabase, forceLogoutUser } = req.app.locals;
    const { id } = req.params;
    const { status } = req.body;

    if (!['active', 'suspended'].includes(status)) {
      return res.status(400).json({ error: 'status must be active or suspended' });
    }

    const { error } = await supabase.from('users').update({ status }).eq('id', id);
    if (error) throw error;

    if (status === 'suspended') {
      await forceLogoutUser(id);
    }

    await logAudit(supabase, {
      actorType: 'super_admin',
      actorId: 'super-admin',
      action: 'update_user_status',
      targetType: 'user',
      targetId: id,
      details: { status },
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.json({ ok: true, status });
  } catch (e) {
    console.error('[Super Admin Update User Status] CRITICAL ERROR:', e);
    // Send the actual error message back to the client for debugging
    res.status(500).json({ error: 'Failed to update status: ' + (e.message || 'Unknown error') });
  }
});

/**
 * DELETE /api/super-admin/users/:id
 * Permanently delete a user
 */
router.delete('/users/:id', async (req, res) => {
  try {
    const { supabase, forceLogoutUser } = req.app.locals;
    const { id } = req.params;

    // Force logout first
    await forceLogoutUser(id);

    // Delete related data (sessions, transactions) will cascade if FK is set,
    // otherwise we clean up manually
    await supabase.from('sessions').delete().eq('user_id', id);
    await supabase.from('credit_transactions').delete().eq('user_id', id);

    const { error } = await supabase.from('users').delete().eq('id', id);
    if (error) throw error;

    await logAudit(supabase, {
      actorType: 'super_admin',
      actorId: req.session.supabaseId,
      action: 'delete_user',
      targetType: 'user',
      targetId: id,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.json({ ok: true });
  } catch (e) {
    console.error('[Super Admin Delete User]', e);
    res.status(500).json({ error: 'Failed to delete user: ' + (e.message || 'Unknown error') });
  }
});

/**
 * PATCH /api/super-admin/users/:id/permissions
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

    // Number.isFinite rejects NaN/Infinity — a bare `typeof amount === 'number'`
    // does NOT catch NaN (NaN is a "number"), which previously let a typo in the
    // "Add credits" box write null and wipe the admin's balance.
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount === 0) {
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

/**
 * PATCH /api/super-admin/users/:id/password
 * Force Reset Password for User
 */
router.patch('/users/:id/password', async (req, res) => {
  try {
    const { supabase, forceLogoutUser } = req.app.locals;
    const { id } = req.params;
    const { password } = req.body;

    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    // 1. Hash new password
    const passwordHash = await hashPassword(password);

    // 2. Update DB
    const { error } = await supabase
      .from('users')
      .update({ password_hash: passwordHash })
      .eq('id', id);

    if (error) throw error;

    // 3. Force logout (security best practice on password change)
    await forceLogoutUser(id);

    // 4. Audit Log
    await logAudit(supabase, {
      actorType: 'super_admin',
      actorId: 'super-admin',
      action: 'reset_user_password',
      targetType: 'user',
      targetId: id,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.json({ ok: true });
  } catch (e) {
    console.error('[Super Admin Reset User Password]', e);
    res.status(500).json({ error: 'Failed to reset user password' });
  }
});

/**
 * PATCH /api/super-admin/admins/:id/password
 * Force Reset Password for Admin
 */
router.patch('/admins/:id/password', async (req, res) => {
  try {
    const { supabase, forceLogoutAdmin, forceLogoutAllUsersUnderAdmin } = req.app.locals;
    const { id } = req.params;
    const { password } = req.body;

    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    // 1. Hash new password
    const passwordHash = await hashPassword(password);

    // 2. Update DB
    const { error } = await supabase
      .from('admins')
      .update({ password_hash: passwordHash })
      .eq('id', id);

    if (error) throw error;

    // 3. Force logout admin and all their users (security best practice)
    await forceLogoutAdmin(id);
    // Optional: Logout their users too? No, usually just the admin account itself. 
    // But if the admin is compromised, maybe? strict security says yes, but let's just do admin for now.
    // Actually, let's just do the admin account.

    // 4. Audit Log
    await logAudit(supabase, {
      actorType: 'super_admin',
      actorId: 'super-admin',
      action: 'reset_admin_password',
      targetType: 'admin',
      targetId: id,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.json({ ok: true });
  } catch (e) {
    console.error('[Super Admin Reset Admin Password]', e);
    res.status(500).json({ error: 'Failed to reset admin password' });
  }
});

/**
 * PATCH /api/super-admin/admins/:id/feature-locks
 * Lock/unlock features for an admin (cascades to all their users)
 * Body: { locks: { canExpand: false, canAnalyze: true, ... } }
 * Setting a key to false = locked. Omitting or deleting a key = unlocked.
 */
router.patch('/admins/:id/feature-locks', async (req, res) => {
  try {
    const { supabase } = req.app.locals;
    const { id } = req.params;
    const { locks } = req.body;

    if (!locks || typeof locks !== 'object') {
      return res.status(400).json({ error: 'locks object required' });
    }

    const { data: admin, error: fetchError } = await supabase
      .from('admins')
      .select('permissions')
      .eq('id', id)
      .single();

    if (fetchError || !admin) {
      return res.status(404).json({ error: 'Admin not found' });
    }

    const currentPerms = admin.permissions || {};
    const currentLocks = currentPerms.superAdminLocks || {};

    // Merge new locks — false = locked, null/undefined = remove lock
    const newLocks = { ...currentLocks };
    for (const [key, val] of Object.entries(locks)) {
      if (val === false) {
        newLocks[key] = false;
      } else {
        delete newLocks[key]; // Unlock = remove the key
      }
    }

    const newPerms = { ...currentPerms, superAdminLocks: newLocks };

    const { error } = await supabase
      .from('admins')
      .update({ permissions: newPerms })
      .eq('id', id);

    if (error) throw error;

    await logAudit(supabase, {
      actorType: 'super_admin',
      actorId: req.session.supabaseId,
      action: 'update_feature_locks',
      targetType: 'admin',
      targetId: id,
      details: { locks: newLocks },
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.json({ ok: true, superAdminLocks: newLocks });
  } catch (e) {
    console.error('[Super Admin Feature Lock Admin]', e);
    res.status(500).json({ error: 'Failed to update feature locks' });
  }
});

/**
 * PATCH /api/super-admin/users/:id/feature-locks
 * Lock/unlock features for a specific user (overrides admin setting)
 * Body: { locks: { canExpand: false, ... } }
 */
router.patch('/users/:id/feature-locks', async (req, res) => {
  try {
    const { supabase } = req.app.locals;
    const { id } = req.params;
    const { locks } = req.body;

    if (!locks || typeof locks !== 'object') {
      return res.status(400).json({ error: 'locks object required' });
    }

    const { data: user, error: fetchError } = await supabase
      .from('users')
      .select('permissions')
      .eq('id', id)
      .single();

    if (fetchError || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const currentPerms = user.permissions || {};
    const currentLocks = currentPerms.superAdminLocks || {};

    const newLocks = { ...currentLocks };
    for (const [key, val] of Object.entries(locks)) {
      if (val === false) {
        newLocks[key] = false;
      } else {
        delete newLocks[key];
      }
    }

    const newPerms = { ...currentPerms, superAdminLocks: newLocks };

    const { error } = await supabase
      .from('users')
      .update({ permissions: newPerms })
      .eq('id', id);

    if (error) throw error;

    await logAudit(supabase, {
      actorType: 'super_admin',
      actorId: req.session.supabaseId,
      action: 'update_feature_locks',
      targetType: 'user',
      targetId: id,
      details: { locks: newLocks },
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.json({ ok: true, superAdminLocks: newLocks });
  } catch (e) {
    console.error('[Super Admin Feature Lock User]', e);
    res.status(500).json({ error: 'Failed to update feature locks' });
  }
});

/**
 * GET /api/super-admin/admins/:id/feature-locks
 * Get current feature locks for an admin
 */
router.get('/admins/:id/feature-locks', async (req, res) => {
  try {
    const { supabase } = req.app.locals;
    const { id } = req.params;

    const { data: admin, error } = await supabase
      .from('admins')
      .select('permissions')
      .eq('id', id)
      .single();

    if (error || !admin) return res.status(404).json({ error: 'Admin not found' });

    res.json({ ok: true, superAdminLocks: admin.permissions?.superAdminLocks || {} });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch feature locks' });
  }
});

/**
 * GET /api/super-admin/users/:id/feature-locks
 * Get current feature locks for a user
 */
router.get('/users/:id/feature-locks', async (req, res) => {
  try {
    const { supabase } = req.app.locals;
    const { id } = req.params;

    const { data: user, error } = await supabase
      .from('users')
      .select('permissions')
      .eq('id', id)
      .single();

    if (error || !user) return res.status(404).json({ error: 'User not found' });

    res.json({ ok: true, superAdminLocks: user.permissions?.superAdminLocks || {} });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch feature locks' });
  }
});

export default router;

