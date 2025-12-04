/**
 * Redis Client & Session Helpers
 */

import { createClient } from 'redis';
import { RedisStore } from 'connect-redis';
import config from '../config/index.js';

// Create Redis client
const redisClient = createClient({
  url: config.REDIS_URL.trim(),
  socket: config.REDIS_USE_TLS
    ? { tls: true, rejectUnauthorized: false }
    : undefined,
});

redisClient.on('error', (err) => {
  console.error('❌ Redis error:', err);
});

redisClient.on('ready', () => {
  console.log('✅ Redis client ready');
});

// Connect to Redis
export async function connectRedis() {
  await redisClient.connect();
  
  // Health check
  try {
    const pong = await redisClient.ping();
    console.log('🔎 Redis PING:', pong);
  } catch (e) {
    console.error('❌ Redis ping failed:', e);
  }
}

// Create session store
export function createSessionStore() {
  return new RedisStore({
    client: redisClient,
    prefix: 'sess:',
  });
}

/* ========================================================================
   SESSION TRACKING HELPERS
   ======================================================================== */

/**
 * Track active session for a user
 */
export async function addActiveSession(userId, sessionId) {
  const key = `active_sessions:${userId}`;
  await redisClient.sAdd(key, sessionId);
  await redisClient.expire(key, config.SESSION_TTL_HOURS * 3600);
}

/**
 * Remove session from active list
 */
export async function removeActiveSession(userId, sessionId) {
  const key = `active_sessions:${userId}`;
  await redisClient.sRem(key, sessionId);
}

/**
 * Get all active sessions for a user
 */
export async function getActiveSessions(userId) {
  const key = `active_sessions:${userId}`;
  return await redisClient.sMembers(key);
}

/* ========================================================================
   FORCE LOGOUT FUNCTIONS
   ======================================================================== */

/**
 * Force logout a specific user by destroying all their sessions
 */
export async function forceLogoutUser(userId) {
  let count = 0;
  for await (const key of redisClient.scanIterator({ MATCH: 'sess:*' })) {
    try {
      const raw = await redisClient.get(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (parsed.supabaseId === userId || parsed.userId === userId) {
        await redisClient.del(key);
        count++;
      }
    } catch (e) { /* ignore */ }
  }
  // Clean up active sessions tracking
  await redisClient.del(`active_sessions:supabase:${userId}`);
  await redisClient.del(`active_sessions:${userId}`);
  return count;
}

/**
 * Force logout an admin by destroying all their sessions
 */
export async function forceLogoutAdmin(adminId) {
  let count = 0;
  for await (const key of redisClient.scanIterator({ MATCH: 'sess:*' })) {
    try {
      const raw = await redisClient.get(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (parsed.supabaseId === adminId && parsed.role === 'admin') {
        await redisClient.del(key);
        count++;
      }
    } catch (e) { /* ignore */ }
  }
  return count;
}

/**
 * Force logout all users under a specific admin
 */
export async function forceLogoutAllUsersUnderAdmin(supabaseClient, adminId) {
  if (!supabaseClient) return 0;
  
  const { data: users } = await supabaseClient
    .from('users')
    .select('id')
    .eq('admin_id', adminId);
  
  if (!users || users.length === 0) return 0;
  
  let totalCount = 0;
  for (const user of users) {
    const count = await forceLogoutUser(user.id);
    totalCount += count;
  }
  return totalCount;
}

/* ========================================================================
   DATA STORAGE HELPERS
   ======================================================================== */

/**
 * Store transcript in Redis
 */
export async function storeTranscript(sessionId, transcript) {
  if (!sessionId || !transcript) return;
  await redisClient.set(`transcript:${sessionId}`, transcript, { EX: 60 * 60 * 24 });
}

/**
 * Get transcript from Redis
 */
export async function getTranscript(sessionId) {
  if (!sessionId) return '';
  return (await redisClient.get(`transcript:${sessionId}`)) || '';
}

/**
 * Store screen analysis in Redis
 */
export async function storeScreenAnalysis(sessionId, analysis) {
  if (!sessionId || !analysis) return;
  await redisClient.set(`screen-analysis:${sessionId}`, analysis, { EX: 60 * 60 * 6 });
}

/**
 * Delete session data (on logout)
 */
export async function deleteSessionData(sessionId) {
  if (!sessionId) return;
  await redisClient.del(`transcript:${sessionId}`);
  await redisClient.del(`screen-analysis:${sessionId}`);
}

export { redisClient };
export default redisClient;

