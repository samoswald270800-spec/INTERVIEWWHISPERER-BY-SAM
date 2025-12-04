/**
 * Rate Limiting Middleware
 */

import { redisClient } from '../lib/redis.js';
import config from '../config/index.js';

/**
 * Rate limit check for analyze-screen endpoint
 */
export async function checkAnalyzeRateLimit(userId) {
  const now = Date.now();
  const today = new Date().toISOString().split('T')[0];

  const lastKey = `analyze_last:${userId}`;
  const countKey = `analyze_count:${userId}:${today}`;

  // 1. Check frequency (1 req / 20s)
  const lastTime = await redisClient.get(lastKey);
  if (lastTime && (now - Number(lastTime) < config.ANALYZE_COOLDOWN_MS)) {
    return { 
      allowed: false, 
      error: 'Slow down. Please wait 20 seconds between analysis requests.' 
    };
  }

  // 2. Check daily limit (50 req / day)
  const dailyCount = await redisClient.get(countKey);
  if (dailyCount && Number(dailyCount) >= config.ANALYZE_DAILY_LIMIT) {
    return { 
      allowed: false, 
      error: `Daily limit reached (${config.ANALYZE_DAILY_LIMIT} analysis requests per day).` 
    };
  }

  // Update counters
  await redisClient.set(lastKey, now);
  await redisClient.incr(countKey);
  await redisClient.expire(countKey, 24 * 3600); // 24h TTL

  return { allowed: true };
}

export default {
  checkAnalyzeRateLimit,
};

