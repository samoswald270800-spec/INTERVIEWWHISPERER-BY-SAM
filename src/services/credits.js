/**
 * Credits Service
 * Handles credit management for sessions
 * 
 * CREDIT RATES:
 * - Interview: 1 token = 6 minutes, minimum 15 minutes (3 tokens)
 * - Screen Analysis: 1 token per analysis
 */

import config from '../config/index.js';

/**
 * Atomically deduct credits from an account using optimistic locking.
 * Returns { success, newCredits } or { success: false, error }.
 *
 * The UPDATE includes `WHERE credits = expectedCredits` so if another
 * request modified the balance between our SELECT and UPDATE, the
 * update affects 0 rows and we return a clear error instead of
 * silently double-spending.
 */
async function atomicDeduct(supabase, table, accountId, amount, expectedCredits) {
  const newCredits = expectedCredits - amount;
  if (newCredits < 0) {
    return { success: false, error: 'Insufficient credits' };
  }

  const { data, error } = await supabase
    .from(table)
    .update({ credits: newCredits })
    .eq('id', accountId)
    .eq('credits', expectedCredits) // Optimistic lock
    .select('credits')
    .single();

  if (error || !data) {
    // 0 rows matched — another request changed credits between read & write
    return { success: false, error: 'Credit balance changed during operation. Please try again.' };
  }

  return { success: true, newCredits: data.credits };
}

/**
 * Atomically add credits to an account using optimistic locking.
 */
async function atomicAdd(supabase, table, accountId, amount, expectedCredits) {
  const newCredits = expectedCredits + amount;

  const { data, error } = await supabase
    .from(table)
    .update({ credits: newCredits })
    .eq('id', accountId)
    .eq('credits', expectedCredits)
    .select('credits')
    .single();

  if (error || !data) {
    return { success: false, error: 'Credit balance changed during operation. Please try again.' };
  }

  return { success: true, newCredits: data.credits };
}

/**
 * Start a new interview session
 */
export async function startSession(supabase, accountId, ownerId, role = 'user', creditMultiplier = 1) {
  if (!supabase) return { success: false, error: 'Supabase not configured' };

  const table = role === 'admin' ? 'admins' : 'users';
  const { data: account } = await supabase
    .from(table)
    .select('credits')
    .eq('id', accountId)
    .single();

  const prepaidAmount = config.MIN_CHARGE_TOKENS * creditMultiplier;
  if (!account || account.credits < prepaidAmount) {
    return {
      success: false,
      error: `Insufficient credits. Minimum ${prepaidAmount} tokens required (${config.MIN_CHARGE_MINUTES} minutes${creditMultiplier > 1 ? ' at ' + creditMultiplier + 'x Turbo rate' : ''}).`
    };
  }

  // Atomically deduct minimum charge — prevents double-click race
  const deductResult = await atomicDeduct(supabase, table, accountId, prepaidAmount, account.credits);
  if (!deductResult.success) {
    return { success: false, error: deductResult.error };
  }
  const newCredits = deductResult.newCredits;

  const sessionData = {
    admin_id: ownerId,
    status: 'active',
    credits_used: prepaidAmount, // Mark as prepaid
    credit_multiplier: creditMultiplier, // 1 = Live, 2 = Turbo
  };

  if (role === 'user') {
    sessionData.user_id = accountId;
  } else {
    // For admin sessions, we must provide a valid user_id (DB constraint).
    // We create/find a system placeholder user for this admin.
    const placeholderName = `admin_session_placeholder_${accountId}`;

    // Check if exists
    let { data: phUser } = await supabase
      .from('users')
      .select('id')
      .eq('username', placeholderName)
      .single();

    if (!phUser) {
      // Create placeholder
      const { data: newUser, error: createError } = await supabase
        .from('users')
        .insert({
          username: placeholderName,
          password_hash: 'placeholder',
          admin_id: accountId,
          credits: 0,
          permissions: {},
          status: 'active'
        })
        .select('id')
        .single();

      if (createError) {
        // Rollback: atomically restore the deducted credits
        await atomicAdd(supabase, table, accountId, prepaidAmount, newCredits);
        return { success: false, error: 'Failed to create system user for admin session: ' + createError.message };
      }
      phUser = newUser;
    }

    sessionData.user_id = phUser.id;
  }

  const { data, error } = await supabase
    .from('sessions')
    .insert(sessionData)
    .select()
    .single();

  if (error) {
    // Rollback: atomically restore the deducted credits
    await atomicAdd(supabase, table, accountId, prepaidAmount, newCredits);
    return { success: false, error: error.message };
  }

  // Log transaction
  const transactionData = {
    admin_id: ownerId,
    type: 'consume',
    amount: -prepaidAmount,
    balance_after: newCredits,
    description: `Session Start (Prepaid${creditMultiplier > 1 ? ' - Turbo ' + creditMultiplier + 'x' : ''})`,
    session_id: data.id,
  };

  if (role === 'user') {
    transactionData.user_id = accountId;
  } else {
    transactionData.user_id = null;
  }

  await supabase.from('credit_transactions').insert(transactionData);

  return { success: true, session: data };
}

/**
 * End an interview session and calculate credits
 */
export async function endSession(supabase, sessionId) {
  if (!supabase) return { success: false, error: 'Supabase not configured' };

  const { data: session, error: fetchError } = await supabase
    .from('sessions')
    .select('*')
    .eq('id', sessionId)
    .eq('status', 'active')
    .single();

  if (fetchError || !session) {
    return { success: false, error: 'Session not found or already ended' };
  }

  const startTime = new Date(session.start_time);
  const endTime = new Date();
  const rawSeconds = Math.floor((endTime - startTime) / 1000);

  // Cap at 4 hours to protect against stale/orphaned sessions draining credits.
  // Super admins never reach this code path so they are unaffected.
  const MAX_SESSION_SECONDS = 4 * 60 * 60; // 14400 seconds
  const totalSeconds = Math.min(rawSeconds, MAX_SESSION_SECONDS);

  if (rawSeconds > MAX_SESSION_SECONDS) {
    console.warn(`[Session End] Session ${sessionId} ran for ${Math.floor(rawSeconds / 60)} mins — capped at 4 hrs for billing.`);
  }

  const prepaid = session.credits_used || 0;
  const multiplier = session.credit_multiplier || 1;

  // Calculate total cost based on capped duration, applying credit multiplier (2x for Turbo)
  let totalCost = Math.ceil(totalSeconds / 360) * multiplier;
  if (totalCost < config.MIN_CHARGE_TOKENS * multiplier) totalCost = config.MIN_CHARGE_TOKENS * multiplier;

  const additionalCost = Math.max(0, totalCost - prepaid);

  // Update session
  const { data, error } = await supabase
    .from('sessions')
    .update({
      end_time: endTime.toISOString(),
      total_seconds: totalSeconds,
      credits_used: totalCost, // Store final total cost
      status: 'completed'
    })
    .eq('id', sessionId)
    .select()
    .single();

  if (error) {
    return { success: false, error: error.message };
  }

  // Deduct additional credits if any
  if (additionalCost > 0) {
    let table = 'users';
    let id = session.user_id;

    if (id) {
      // Determine who to actually charge: the real user, or the admin (if this was an admin session).
      // Admin sessions use a placeholder user_id, so we check if this user is a placeholder.
      // If the lookup fails for ANY reason, we default to charging the admin (fail-safe: never give free sessions).
      let chargeAdmin = false;

      try {
        const { data: u } = await supabase
          .from('users')
          .select('username')
          .eq('id', id)
          .single();

        if (u && u.username && u.username.startsWith('admin_session_placeholder_')) {
          chargeAdmin = true;
        } else if (!u) {
          // User not found at all — likely an admin placeholder that was deleted. Charge admin.
          console.warn(`[Session End] user_id ${id} not found in users table. Defaulting to admin charge.`);
          chargeAdmin = true;
        }
      } catch (lookupErr) {
        // DB error during lookup — fail-safe: charge the admin so nobody gets a free session
        console.warn(`[Session End] Placeholder lookup failed: ${lookupErr.message}. Defaulting to admin charge.`);
        chargeAdmin = true;
      }

      if (chargeAdmin) {
        table = 'admins';
        id = session.admin_id;
      }

      const { data: account } = await supabase
        .from(table)
        .select('credits')
        .eq('id', id)
        .single();

      if (account) {
        const deductResult = await atomicDeduct(supabase, table, id, additionalCost, account.credits);
        const newCredits = deductResult.success ? deductResult.newCredits : Math.max(0, account.credits - additionalCost);

        if (!deductResult.success) {
          // Fallback: force-set if optimistic lock fails (session billing must not silently skip)
          await supabase.from(table).update({ credits: Math.max(0, account.credits - additionalCost) }).eq('id', id);
          console.warn(`[Session End] Optimistic lock failed for ${table}:${id}, used force-deduct fallback.`);
        }

        const transactionData = {
          admin_id: session.admin_id,
          type: 'consume',
          amount: -additionalCost,
          balance_after: newCredits,
          description: `Session Additional Charge (${Math.floor(totalSeconds / 60)} mins total)`,
          session_id: sessionId,
        };

        if (table === 'users' && !session.user_id) {
          transactionData.user_id = null; // Should not happen with workaround
        } else {
          transactionData.user_id = session.user_id;
        }

        await supabase.from('credit_transactions').insert(transactionData);
      }
    }
  }

  return { success: true, session: data, creditsUsed: totalCost, additionalCost };
}

/**
 * Get active session for a user
 */
export async function getActiveSession(supabase, accountId, role = 'user') {
  if (!supabase) return null;

  let query = supabase
    .from('sessions')
    .select('*')
    .eq('status', 'active');

  if (role === 'admin') {
    // For admin, we query by admin_id AND check for our placeholder mechanism
    // Actually, sessions now have a user_id (the placeholder).
    // So getActiveSession(supabase, accountId, 'admin') should look for sessions 
    // where admin_id = accountId AND user_id implies placeholder?
    // OR just any active session for this admin?
    // If admin is running a session, they are running it AS the placeholder user.
    // So query should check admin_id.
    query = query.eq('admin_id', accountId);
    // Be careful: if admin has MULTIPLE users active?
    // We want the session *started by the admin for themselves*.
    // Which is identified by user.username starting with placeholder...
    // But we can't join easily here without complexity.
    // Simplification: Check if ANY session is active where admin_id = accountId AND user_id refers to placeholder.
    // We can fetch the placeholder ID first?
    const placeholderName = `admin_session_placeholder_${accountId}`;
    const { data: phUser } = await supabase.from('users').select('id').eq('username', placeholderName).single();
    if (phUser) {
      query = query.eq('user_id', phUser.id);
    } else {
      // No placeholder user exists, so no active admin session of this type.
      return null;
    }
  } else {
    query = query.eq('user_id', accountId);
  }

  const { data } = await query.single();

  return data || null;
}

/**
 * Charge credits for screen analysis (1 token)
 */
export async function chargeScreenAnalysis(supabase, accountId, adminId, role = 'user') {
  if (!supabase) return { success: false, error: 'Supabase not configured' };

  // Super admins are never charged
  if (role === 'super_admin') return { success: true, charged: 0, newBalance: Infinity };

  const table = role === 'admin' ? 'admins' : 'users';
  const { data: account } = await supabase
    .from(table)
    .select('credits')
    .eq('id', accountId)
    .single();

  if (!account || account.credits < config.SCREEN_ANALYSIS_COST) {
    return { success: false, error: 'Insufficient credits for screen analysis' };
  }

  const deductResult = await atomicDeduct(supabase, table, accountId, config.SCREEN_ANALYSIS_COST, account.credits);
  if (!deductResult.success) {
    return { success: false, error: deductResult.error };
  }
  const newCredits = deductResult.newCredits;

  const transactionData = {
    admin_id: adminId || (role === 'admin' ? accountId : null),
    type: 'screen_analysis',
    amount: -config.SCREEN_ANALYSIS_COST,
    balance_after: newCredits,
    description: 'Screen analysis'
  };

  if (role === 'user') {
    transactionData.user_id = accountId;
  }

  await supabase.from('credit_transactions').insert(transactionData);

  return { success: true, charged: config.SCREEN_ANALYSIS_COST, newBalance: newCredits };
}

/**
 * Get minimum charge tokens
 */
export function getMinimumChargeTokens() {
  return config.MIN_CHARGE_TOKENS;
}

/**
 * Get screen analysis cost
 */
export function getScreenAnalysisCost() {
  return config.SCREEN_ANALYSIS_COST;
}

/**
 * Assign credits from admin to user
 */
export async function assignCreditsToUser(supabase, { userId, adminId, amount, description }) {
  if (!supabase) return { success: false, error: 'Supabase not configured' };
  if (amount <= 0) return { success: false, error: 'Amount must be positive' };

  const { data: admin } = await supabase
    .from('admins')
    .select('credits')
    .eq('id', adminId)
    .single();

  if (!admin || admin.credits < amount) {
    return { success: false, error: 'Insufficient admin credits' };
  }

  const { data: user } = await supabase
    .from('users')
    .select('credits, admin_id')
    .eq('id', userId)
    .single();

  if (!user) return { success: false, error: 'User not found' };
  if (user.admin_id !== adminId) return { success: false, error: 'User does not belong to this admin' };

  // Atomically deduct from admin
  const adminDeduct = await atomicDeduct(supabase, 'admins', adminId, amount, admin.credits);
  if (!adminDeduct.success) return { success: false, error: adminDeduct.error };

  // Atomically add to user
  const userAdd = await atomicAdd(supabase, 'users', userId, amount, user.credits);
  if (!userAdd.success) {
    // Rollback admin deduction
    await atomicAdd(supabase, 'admins', adminId, amount, adminDeduct.newCredits);
    return { success: false, error: 'Failed to add credits to user. Admin credits restored.' };
  }

  await supabase.from('credit_transactions').insert({
    user_id: userId,
    admin_id: adminId,
    type: 'assign',
    amount,
    balance_after: userAdd.newCredits,
    description: description || 'Credits assigned',
  });

  return { success: true, adminCredits: adminDeduct.newCredits, userCredits: userAdd.newCredits };
}

/**
 * Reclaim credits from user back to admin
 */
export async function reclaimCreditsFromUser(supabase, { userId, adminId, amount, description }) {
  if (!supabase) return { success: false, error: 'Supabase not configured' };
  if (amount <= 0) return { success: false, error: 'Amount must be positive' };

  const { data: admin } = await supabase.from('admins').select('credits').eq('id', adminId).single();
  const { data: user } = await supabase.from('users').select('credits, admin_id').eq('id', userId).single();

  if (!user) return { success: false, error: 'User not found' };
  if (user.admin_id !== adminId) return { success: false, error: 'User does not belong to this admin' };

  const actualAmount = Math.min(amount, user.credits);
  if (actualAmount <= 0) return { success: false, error: 'User has no credits to reclaim' };

  // Atomically deduct from user
  const userDeduct = await atomicDeduct(supabase, 'users', userId, actualAmount, user.credits);
  if (!userDeduct.success) return { success: false, error: userDeduct.error };

  // Atomically add to admin
  const adminAdd = await atomicAdd(supabase, 'admins', adminId, actualAmount, admin.credits);
  if (!adminAdd.success) {
    // Rollback user deduction
    await atomicAdd(supabase, 'users', userId, actualAmount, userDeduct.newCredits);
    return { success: false, error: 'Failed to return credits to admin. User credits restored.' };
  }

  await supabase.from('credit_transactions').insert({
    user_id: userId,
    admin_id: adminId,
    type: 'reclaim',
    amount: -actualAmount,
    balance_after: userDeduct.newCredits,
    description: description || 'Credits reclaimed',
  });

  return { success: true, adminCredits: adminAdd.newCredits, userCredits: userDeduct.newCredits, reclaimedAmount: actualAmount };
}

/**
 * Add credits to admin (Super Admin action)
 */
export async function addCreditsToAdmin(supabase, { adminId, amount, description }) {
  if (!supabase) return { success: false, error: 'Supabase not configured' };
  if (amount <= 0) return { success: false, error: 'Amount must be positive' };

  const { data: admin } = await supabase.from('admins').select('credits').eq('id', adminId).single();
  if (!admin) return { success: false, error: 'Admin not found' };

  const newCredits = admin.credits + amount;
  await supabase.from('admins').update({ credits: newCredits }).eq('id', adminId);

  await supabase.from('credit_transactions').insert({
    admin_id: adminId,
    type: 'admin_refill',
    amount,
    balance_after: newCredits,
    description: description || 'Credits added by Super Admin',
  });

  return { success: true, newCredits };
}

/**
 * Deduct credits from admin (Super Admin action)
 */
export async function deductCreditsFromAdmin(supabase, { adminId, amount, description }) {
  if (!supabase) return { success: false, error: 'Supabase not configured' };
  if (amount <= 0) return { success: false, error: 'Amount must be positive' };

  const { data: admin } = await supabase.from('admins').select('credits').eq('id', adminId).single();
  if (!admin) return { success: false, error: 'Admin not found' };

  const actualAmount = Math.min(amount, admin.credits);
  const newCredits = admin.credits - actualAmount;

  await supabase.from('admins').update({ credits: newCredits }).eq('id', adminId);

  await supabase.from('credit_transactions').insert({
    admin_id: adminId,
    type: 'admin_deduct',
    amount: -actualAmount,
    balance_after: newCredits,
    description: description || 'Credits deducted by Super Admin',
  });

  return { success: true, newCredits, deductedAmount: actualAmount };
}

/**
 * Get user credit history
 */
export async function getUserCreditHistory(supabase, userId, limit = 50) {
  if (!supabase) return { success: false, error: 'Supabase not configured' };

  const { data, error } = await supabase
    .from('credit_transactions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) return { success: false, error: error.message };
  return { success: true, transactions: data };
}

/**
 * Get admin credit history
 */
export async function getAdminCreditHistory(supabase, adminId, limit = 50) {
  if (!supabase) return { success: false, error: 'Supabase not configured' };

  const { data, error } = await supabase
    .from('credit_transactions')
    .select('*, users(username)')
    .eq('admin_id', adminId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) return { success: false, error: error.message };
  return { success: true, transactions: data };
}

/**
 * Get user session history
 */
export async function getUserSessionHistory(supabase, userId, limit = 50) {
  if (!supabase) return { success: false, error: 'Supabase not configured' };

  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .eq('user_id', userId)
    .order('start_time', { ascending: false })
    .limit(limit);

  if (error) return { success: false, error: error.message };
  return { success: true, sessions: data };
}

/**
 * Get admin session history
 */
export async function getAdminSessionHistory(supabase, adminId, limit = 100) {
  if (!supabase) return { success: false, error: 'Supabase not configured' };

  const { data, error } = await supabase
    .from('sessions')
    .select('*, users(username)')
    .eq('admin_id', adminId)
    .order('start_time', { ascending: false })
    .limit(limit);

  if (error) return { success: false, error: error.message };
  return { success: true, sessions: data };
}

export default {
  startSession,
  endSession,
  getActiveSession,
  chargeScreenAnalysis,
  getMinimumChargeTokens,
  getScreenAnalysisCost,
  assignCreditsToUser,
  reclaimCreditsFromUser,
  addCreditsToAdmin,
  deductCreditsFromAdmin,
  getUserCreditHistory,
  getAdminCreditHistory,
  getUserSessionHistory,
  getAdminSessionHistory,
};

