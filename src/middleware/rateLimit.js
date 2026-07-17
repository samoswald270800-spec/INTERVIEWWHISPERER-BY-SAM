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

/* ========================================================================
   LOGIN BRUTE-FORCE PROTECTION
   Blocks after LOGIN_MAX_ATTEMPTS failed attempts against the same IP or
   username within a rolling window.

   IMPORTANT: the SUPER ADMIN login is intentionally NOT protected by this —
   the super admin is exempt from every rate limit / lockout by design. Only
   the user and admin login routes call these helpers.
   ======================================================================== */

const LOGIN_MAX_ATTEMPTS = 100;            // lock out after 100 failed tries
const LOGIN_WINDOW_SECONDS = 15 * 60;      // rolling 15-minute window

/**
 * Returns { allowed: false, error } if any of the given identifiers is at/over
 * the failed-attempt threshold; otherwise { allowed: true }.
 */
export async function checkLoginLockout(keyParts) {
  for (const part of keyParts) {
    if (!part) continue;
    const count = Number(await redisClient.get(`login_fail:${part}`)) || 0;
    if (count >= LOGIN_MAX_ATTEMPTS) {
      return {
        allowed: false,
        error: 'Too many failed login attempts. Please wait 15 minutes and try again.',
      };
    }
  }
  return { allowed: true };
}

/** Increment the failed-attempt counters (sliding 15-minute window). */
export async function recordLoginFailure(keyParts) {
  for (const part of keyParts) {
    if (!part) continue;
    const key = `login_fail:${part}`;
    await redisClient.incr(key);
    await redisClient.expire(key, LOGIN_WINDOW_SECONDS);
  }
}

/** Clear the counters after a successful login. */
export async function clearLoginFailures(keyParts) {
  for (const part of keyParts) {
    if (!part) continue;
    await redisClient.del(`login_fail:${part}`);
  }
}

export default {
  checkAnalyzeRateLimit,
  checkLoginLockout,
  recordLoginFailure,
  clearLoginFailures,
};

