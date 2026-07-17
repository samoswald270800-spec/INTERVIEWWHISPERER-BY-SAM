/**
 * Authentication Service
 * - Super Admin: Auth via ENV VARS ONLY (no database)
 * - Admin & User: Auth via Supabase with USERNAME (not email)
 */

import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import config from '../config/index.js';

const SALT_ROUNDS = 12;

// Organization login code. Uses an unambiguous alphabet (no 0/O, 1/I/L) so it's
// easy to read aloud and type. Shown in the admin + super-admin dashboards and
// (small) in the user's own space; required on the user login screen.
const ORG_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomOrgCode(length = 6) {
  const bytes = crypto.randomBytes(length);
  let code = '';
  for (let i = 0; i < length; i++) code += ORG_CODE_ALPHABET[bytes[i] % ORG_CODE_ALPHABET.length];
  return code;
}

/** Generate an org code that isn't already taken by another admin. */
async function generateUniqueOrgCode(supabase) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = randomOrgCode(6);
    const { data } = await supabase.from('admins').select('id').eq('org_code', code).maybeSingle();
    if (!data) return code;
  }
  return randomOrgCode(8); // extremely unlikely fallback
}

/**
 * Hash a password
 */
export async function hashPassword(password) {
  return bcrypt.hash(password, SALT_ROUNDS);
}

/**
 * Verify a password against a hash
 */
export async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

/**
 * Constant-time string comparison to prevent timing attacks
 */
function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Authenticate Super Admin (via environment variables ONLY - no database)
 * Easter egg login - checks SUPER_ADMIN_USERNAME and SUPER_ADMIN_PASSWORD env vars
 */
export async function authenticateSuperAdmin(username, password) {
  const validUsername = config.SUPER_ADMIN_USERNAME;
  const validPassword = config.SUPER_ADMIN_PASSWORD;

  if (!validUsername || !validPassword) {
    return { success: false, error: 'Super Admin not configured' };
  }

  if (safeCompare(username, validUsername) && safeCompare(password, validPassword)) {
    return {
      success: true,
      user: {
        id: 'super-admin',
        username: validUsername,
        role: 'super_admin',
      }
    };
  }

  return { success: false, error: 'Invalid credentials' };
}

/**
 * Authenticate Admin (Consultancy) - via Supabase using USERNAME
 */
export async function authenticateAdmin(supabase, username, password) {
  const { data: admin, error } = await supabase
    .from('admins')
    .select('id, username, name, credits, status, password_hash')
    .eq('username', username)
    .single();

  if (error || !admin) {
    return { success: false, error: 'Invalid credentials' };
  }

  if (admin.status !== 'active') {
    return { success: false, error: 'Account is suspended or expired' };
  }

  const valid = await verifyPassword(password, admin.password_hash);
  if (!valid) {
    return { success: false, error: 'Invalid credentials' };
  }

  // Update last login
  await supabase
    .from('admins')
    .update({ last_login: new Date().toISOString() })
    .eq('id', admin.id);

  return {
    success: true,
    user: {
      id: admin.id,
      username: admin.username,
      name: admin.name,
      credits: admin.credits,
      role: 'admin',
    }
  };
}

/**
 * Authenticate User (Candidate) - via Supabase using USERNAME
 */
export async function authenticateUser(supabase, username, password, adminId = null) {
  let query = supabase
    .from('users')
    .select('*, admins!inner(id, name, status)')
    .eq('username', username);

  if (adminId) {
    query = query.eq('admin_id', adminId);
  }

  const { data: users, error } = await query;

  if (error || !users || users.length === 0) {
    return { success: false, error: 'Invalid credentials' };
  }

  for (const user of users) {
    if (user.status !== 'active') continue;
    if (user.admins.status !== 'active') continue;

    const valid = await verifyPassword(password, user.password_hash);
    if (valid) {
      await supabase
        .from('users')
        .update({ last_login: new Date().toISOString() })
        .eq('id', user.id);

      return {
        success: true,
        user: {
          id: user.id,
          username: user.username,
          adminId: user.admin_id,
          adminName: user.admins.name,
          credits: user.credits,
          permissions: user.permissions,
          role: 'user',
        }
      };
    }
  }

  return { success: false, error: 'Invalid credentials' };
}

/**
 * Create Admin (by Super Admin) - uses USERNAME
 */
export async function createAdmin(supabase, { name, username, password, credits = 0 }) {
  const { data: existingAdmins, error: existingAdminError } = await supabase
    .from('admins')
    .select('id')
    .eq('username', username)
    .limit(1);

  if (existingAdminError) {
    return { success: false, error: existingAdminError.message };
  }

  if (existingAdmins && existingAdmins.length > 0) {
    return { success: false, error: 'Username already exists' };
  }

  const passwordHash = await hashPassword(password);
  const orgCode = await generateUniqueOrgCode(supabase);

  const { data, error } = await supabase
    .from('admins')
    .insert({
      name,
      username,
      password_hash: passwordHash,
      credits,
      status: 'active',
      org_code: orgCode,
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      return { success: false, error: 'Username already exists' };
    }
    return { success: false, error: error.message };
  }

  return { success: true, admin: { ...data, password_hash: undefined } };
}

/**
 * Create User (by Admin) - uses USERNAME
 */
export async function createUser(supabase, { username, password, credits = 0, permissions = {}, adminId }) {
  const { data: existingUsers, error: existingUserError } = await supabase
    .from('users')
    .select('id')
    .eq('username', username)
    .eq('admin_id', adminId)
    .limit(1);

  if (existingUserError) {
    return { success: false, error: existingUserError.message };
  }

  if (existingUsers && existingUsers.length > 0) {
    return { success: false, error: 'Username already exists for this organization' };
  }

  const passwordHash = await hashPassword(password);

  const { data, error } = await supabase
    .from('users')
    .insert({
      username,
      password_hash: passwordHash,
      admin_id: adminId,
      credits,
      permissions: { canExpand: true, canAnalyze: true, ...permissions },
      status: 'active',
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      return { success: false, error: 'Username already exists for this organization' };
    }
    return { success: false, error: error.message };
  }

  return { success: true, user: { ...data, password_hash: undefined } };
}

/**
 * Update User Permissions
 */
export async function updateUserPermissions(supabase, userId, permissions) {
  const { data, error } = await supabase
    .from('users')
    .update({ permissions })
    .eq('id', userId)
    .select()
    .single();

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true, user: data };
}

/**
 * Log Audit Event
 */
export async function logAudit(supabase, { actorType, actorId, action, targetType, targetId, details, ip, userAgent }) {
  if (!supabase) return;

  const { error } = await supabase
    .from('audit_logs')
    .insert({
      actor_type: actorType,
      actor_id: actorId,
      action,
      target_type: targetType,
      target_id: targetId,
      details,
      ip_address: ip,
      user_agent: userAgent,
    });

  if (error) {
    console.error('Failed to log audit:', error.message);
  }
}

export default {
  hashPassword,
  verifyPassword,
  authenticateSuperAdmin,
  authenticateAdmin,
  authenticateUser,
  createAdmin,
  createUser,
  updateUserPermissions,
  logAudit,
};

