/**
 * Credits Service
 * Handles credit management for sessions
 */

// Credit rates
const TOKENS_PER_HOUR = 10;      // 10 tokens = 1 hour
const MIN_CHARGE_TOKENS = 2;     // Minimum 2 tokens per session (~12 minutes)
const SCREEN_ANALYSIS_COST = 1;  // 1 token per analysis

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
    return { success: false, error: 'Insufficient credits' };
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
  
  // Get session
  const { data: session, error: fetchError } = await supabase
    .from('sessions')
    .select('*')
    .eq('id', sessionId)
    .eq('status', 'active')
    .single();

  if (fetchError || !session) {
    return { success: false, error: 'Session not found or already ended' };
  }

  // Calculate duration
  const startTime = new Date(session.start_time);
  const endTime = new Date();
  const totalSeconds = Math.floor((endTime - startTime) / 1000);
  
  // Calculate credits (1 token = 6 minutes = 360 seconds, minimum 2 tokens)
  let creditsUsed = Math.ceil(totalSeconds / 360);
  if (creditsUsed < MIN_CHARGE_TOKENS) creditsUsed = MIN_CHARGE_TOKENS;

  // Update session
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

  // Get current user credits and deduct
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
    
    // Log transaction
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
 * Charge credits for screen analysis
 */
export async function chargeScreenAnalysis(supabase, userId, adminId) {
  if (!supabase) return { success: false, error: 'Supabase not configured' };
  
  // Get current credits
  const { data: user } = await supabase
    .from('users')
    .select('credits')
    .eq('id', userId)
    .single();
  
  if (!user || user.credits < SCREEN_ANALYSIS_COST) {
    return { success: false, error: 'Insufficient credits for screen analysis' };
  }
  
  const newCredits = user.credits - SCREEN_ANALYSIS_COST;
  
  // Deduct from user
  await supabase
    .from('users')
    .update({ credits: newCredits })
    .eq('id', userId);

  // Log transaction
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
