/**
 * Credits Service
 * Handles credit management for sessions
 * 
 * CREDIT RATES:
 * - Interview: 1 token = 6 minutes, minimum 15 minutes (3 tokens)
 * - Screen Analysis: 1 token per analysis
 */

// Credit rates
const TOKENS_PER_HOUR = 10;           // 10 tokens = 1 hour (1 token = 6 mins)
const MIN_CHARGE_MINUTES = 15;        // Minimum 15 minutes charge
const MIN_CHARGE_TOKENS = 3;          // 15 mins = 3 tokens (rounded up)
const SCREEN_ANALYSIS_COST = 1;       // 1 token per screen analysis

/**
 * Start a new interview session
 */
export async function startSession(supabase, userId, adminId) {
  if (!supabase) return { success: false, error: 'Supabase not configured' };
  
  // Check if user has minimum credits
  const { data: user } = await supabase
    .from('users')
    .select('credits')
    .eq('id', userId)
    .single();
  
  if (!user || user.credits < MIN_CHARGE_TOKENS) {
    return { success: false, error: `Insufficient credits. Minimum ${MIN_CHARGE_TOKENS} tokens required (${MIN_CHARGE_MINUTES} minutes).` };
  }
  
  const { data, error } = await supabase
    .from('sessions')
    .insert({
      user_id: userId,
      admin_id: adminId,
      status: 'active'
    })
    .select()
    .single();

  if (error) {
    return { success: false, error: error.message };
  }

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
  const totalSeconds = Math.floor((endTime - startTime) / 1000);
  
  // Calculate credits: 1 token = 6 minutes = 360 seconds
  // Minimum: 15 minutes = 3 tokens
  let creditsUsed = Math.ceil(totalSeconds / 360);
  if (creditsUsed < MIN_CHARGE_TOKENS) creditsUsed = MIN_CHARGE_TOKENS;

  const { data, error } = await supabase
    .from('sessions')
    .update({
      end_time: endTime.toISOString(),
      total_seconds: totalSeconds,
      credits_used: creditsUsed,
      status: 'completed'
    })
    .eq('id', sessionId)
    .select()
    .single();

  if (error) {
    return { success: false, error: error.message };
  }

  // Deduct from user
  const { data: user } = await supabase
    .from('users')
    .select('credits')
    .eq('id', session.user_id)
    .single();
  
  if (user) {
    const newCredits = Math.max(0, user.credits - creditsUsed);
    await supabase
      .from('users')
      .update({ credits: newCredits })
      .eq('id', session.user_id);
    
    await supabase.from('credit_transactions').insert({
      user_id: session.user_id,
      admin_id: session.admin_id,
      type: 'consume',
      amount: -creditsUsed,
      balance_after: newCredits,
      description: `Session: ${Math.floor(totalSeconds / 60)} minutes`,
      session_id: sessionId,
    });
  }

  return { success: true, session: data, creditsUsed };
}

/**
 * Get active session for a user
 */
export async function getActiveSession(supabase, userId) {
  if (!supabase) return null;
  
  const { data } = await supabase
    .from('sessions')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'active')
    .single();

  return data || null;
}

/**
 * Charge credits for screen analysis (1 token)
 */
export async function chargeScreenAnalysis(supabase, userId, adminId) {
  if (!supabase) return { success: false, error: 'Supabase not configured' };
  
  const { data: user } = await supabase
    .from('users')
    .select('credits')
    .eq('id', userId)
    .single();
  
  if (!user || user.credits < SCREEN_ANALYSIS_COST) {
    return { success: false, error: 'Insufficient credits for screen analysis' };
  }
  
  const newCredits = user.credits - SCREEN_ANALYSIS_COST;
  
  await supabase
    .from('users')
    .update({ credits: newCredits })
    .eq('id', userId);

  await supabase
    .from('credit_transactions')
    .insert({
      user_id: userId,
      admin_id: adminId,
      type: 'screen_analysis',
      amount: -SCREEN_ANALYSIS_COST,
      balance_after: newCredits,
      description: 'Screen analysis'
    });

  return { success: true, charged: SCREEN_ANALYSIS_COST, newBalance: newCredits };
}

/**
 * Get minimum charge tokens
 */
export function getMinimumChargeTokens() {
  return MIN_CHARGE_TOKENS;
}

/**
 * Get screen analysis cost
 */
export function getScreenAnalysisCost() {
  return SCREEN_ANALYSIS_COST;
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

  const newAdminCredits = admin.credits - amount;
  const newUserCredits = user.credits + amount;

  await supabase.from('admins').update({ credits: newAdminCredits }).eq('id', adminId);
  await supabase.from('users').update({ credits: newUserCredits }).eq('id', userId);

  await supabase.from('credit_transactions').insert({
    user_id: userId,
    admin_id: adminId,
    type: 'assign',
    amount,
    balance_after: newUserCredits,
    description: description || 'Credits assigned',
  });

  return { success: true, adminCredits: newAdminCredits, userCredits: newUserCredits };
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

  const newUserCredits = user.credits - actualAmount;
  const newAdminCredits = admin.credits + actualAmount;

  await supabase.from('users').update({ credits: newUserCredits }).eq('id', userId);
  await supabase.from('admins').update({ credits: newAdminCredits }).eq('id', adminId);

  await supabase.from('credit_transactions').insert({
    user_id: userId,
    admin_id: adminId,
    type: 'reclaim',
    amount: -actualAmount,
    balance_after: newUserCredits,
    description: description || 'Credits reclaimed',
  });

  return { success: true, adminCredits: newAdminCredits, userCredits: newUserCredits, reclaimedAmount: actualAmount };
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
