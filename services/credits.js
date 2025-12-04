/**
 * Credits Service
 * Handles credit management for sessions
 */

/**
 * Start a new interview session
 */
export async function startSession(supabase, userId, adminId) {
  if (!supabase) return { success: false, error: 'Supabase not configured' };
  
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
  
  // Calculate credits (1 credit = 6 minutes, minimum 2 credits)
  let creditsUsed = Math.ceil(totalSeconds / 360);
  if (creditsUsed < 2) creditsUsed = 2;

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

  // Deduct credits from user
  await supabase.rpc('deduct_user_credits', { 
    p_user_id: session.user_id, 
    p_amount: creditsUsed 
  }).catch(() => {
    // If RPC doesn't exist, do it manually
    return supabase
      .from('users')
      .update({ credits: supabase.raw(`credits - ${creditsUsed}`) })
      .eq('id', session.user_id);
  });

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
  
  const SCREEN_ANALYSIS_COST = 1; // 1 credit per analysis

  // Log transaction
  await supabase
    .from('credit_transactions')
    .insert({
      user_id: userId,
      admin_id: adminId,
      type: 'screen_analysis',
      amount: -SCREEN_ANALYSIS_COST,
      description: 'Screen analysis charge'
    });

  // Deduct from user
  const { error } = await supabase
    .from('users')
    .update({ credits: supabase.raw(`credits - ${SCREEN_ANALYSIS_COST}`) })
    .eq('id', userId)
    .gt('credits', 0);

  if (error) {
    return { success: false, error: 'Insufficient credits or update failed' };
  }

  return { success: true, charged: SCREEN_ANALYSIS_COST };
}

