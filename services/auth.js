/**
 * Authentication Service
 * Handles authentication for multi-tenant system
 * - Super Admins: use USERNAME
 * - Admins & Users: use EMAIL
 */

import bcrypt from 'bcrypt';

const SALT_ROUNDS = 12;

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
 * Seed Super Admin on first boot
 * Uses: SUPER_ADMIN_USERNAME, SUPER_ADMIN_PASSWORD
 */
export async function seedSuperAdmin(supabase) {
  const username = process.env.SUPER_ADMIN_USERNAME;
  const password = process.env.SUPER_ADMIN_PASSWORD;

  if (!username || !password) {
    console.log("ℹ️  No SUPER_ADMIN_USERNAME/PASSWORD set. Skipping super admin seed.");
    return null;
  }

  // Check if super admin already exists
  const { data: existing } = await supabase
    .from('super_admins')
    .select('id')
    .eq('username', username)
    .single();

  if (existing) {
    console.log("✅ Super Admin already exists:", username);
    return existing;
  }

  // Create new super admin
  const passwordHash = await hashPassword(password);
  const { data, error } = await supabase
    .from('super_admins')
    .insert({
      username,
      password_hash: passwordHash,
    })
    .select()
    .single();

  if (error) {
    console.error("❌ Failed to seed Super Admin:", error.message);
    return null;
  }

  console.log("✅ Super Admin created:", username);
  return data;
}

/**
 * Authenticate Super Admin
 */
export async function authenticateSuperAdmin(supabase, username, password) {
  const { data: admin, error } = await supabase
    .from('super_admins')
    .select('*')
    .eq('username', username)
    .eq('is_active', true)
    .single();

  if (error || !admin) {
    return { success: false, error: 'Invalid credentials' };
  }

  const valid = await verifyPassword(password, admin.password_hash);
  if (!valid) {
    return { success: false, error: 'Invalid credentials' };
  }

  // Update last login
  await supabase
    .from('super_admins')
    .update({ last_login: new Date().toISOString() })
    .eq('id', admin.id);

  return {
    success: true,
    user: {
      id: admin.id,
      username: admin.username,
      role: 'super_admin',
    }
  };
}

/**
 * Authenticate Admin (Consultancy)
 */
export async function authenticateAdmin(supabase, email, password) {
  const { data: admin, error } = await supabase
    .from('admins')
    .select('*')
    .eq('email', email)
    .single();

  if (error || !admin) {
    return { success: false, error: 'Invalid credentials' };
  }

  if (admin.status !== 'active') {
    return { success: false, error: 'Account is suspended' };
  }

  const valid = await verifyPassword(password, admin.password_hash);
  if (!valid) {
    return { success: false, error: 'Invalid credentials' };
  }

  await supabase
    .from('admins')
    .update({ last_login: new Date().toISOString() })
    .eq('id', admin.id);

  return {
    success: true,
    user: {
      id: admin.id,
      email: admin.email,
      name: admin.name,
      credits: admin.credits,
      role: 'admin',
    }
  };
}

/**
 * Authenticate User (Candidate)
 */
export async function authenticateUser(supabase, email, password, adminId = null) {
  let query = supabase
    .from('users')
    .select('*, admins!inner(id, name, status)')
    .eq('email', email);

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
          email: user.email,
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
 * Create Admin (by Super Admin)
 */
export async function createAdmin(supabase, { name, email, password, credits = 0, createdBy }) {
  // Check if email already exists
  const { data: existing } = await supabase
    .from('admins')
    .select('id')
    .eq('email', email)
    .single();

  if (existing) {
    return { success: false, error: 'Email already exists' };
  }

  const passwordHash = await hashPassword(password);

  const { data, error } = await supabase
    .from('admins')
    .insert({
      name,
      email,
      password_hash: passwordHash,
      credits,
      status: 'active',
      created_by: createdBy,
    })
    .select()
    .single();

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true, admin: { ...data, password_hash: undefined } };
}

/**
 * Create User (by Admin)
 */
export async function createUser(supabase, { email, password, credits = 0, permissions = {}, adminId }) {
  // Check if email already exists for this admin
  const { data: existing } = await supabase
    .from('users')
    .select('id')
    .eq('email', email)
    .eq('admin_id', adminId)
    .single();

  if (existing) {
    return { success: false, error: 'User already exists with this email' };
  }

  const passwordHash = await hashPassword(password);

  const { data, error } = await supabase
    .from('users')
    .insert({
      email,
      password_hash: passwordHash,
      admin_id: adminId,
      credits,
      permissions: { canExpand: true, canAnalyze: true, ...permissions },
      status: 'active',
    })
    .select()
    .single();

  if (error) {
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
