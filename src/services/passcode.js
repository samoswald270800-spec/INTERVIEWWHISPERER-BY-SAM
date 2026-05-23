/**
 * Passcode Service
 * Generates and manages 6-digit passcodes for remote control connections
 * Stored in Redis with 5-minute TTL
 */

import { redisClient } from '../lib/redis.js';

const PASSCODE_PREFIX = 'rc_passcode:';
const PASSCODE_TTL = 300; // 5 minutes

/**
 * Generate a random 6-digit passcode
 */
function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Create a new passcode for a user session
 * @param {string} userId - The Supabase user ID
 * @returns {{ code: string, expiresAt: number }}
 */
export async function createPasscode(userId) {
  const code = generateCode();
  const expiresAt = Date.now() + (PASSCODE_TTL * 1000);

  // Store: passcode -> userId mapping (for admin lookup)
  await redisClient.set(`${PASSCODE_PREFIX}${code}`, JSON.stringify({
    userId,
    createdAt: Date.now(),
    expiresAt,
  }), { EX: PASSCODE_TTL });

  // Store: userId -> passcode mapping (for user to see their code)
  await redisClient.set(`${PASSCODE_PREFIX}user:${userId}`, code, { EX: PASSCODE_TTL });

  console.log(`[Passcode] Created code ${code} for user ${userId} (TTL: ${PASSCODE_TTL}s)`);
  return { code, expiresAt };
}

/**
 * Verify a passcode and return the associated userId
 * @param {string} code - The 6-digit passcode
 * @returns {{ valid: boolean, userId?: string }}
 */
export async function verifyPasscode(code) {
  const raw = await redisClient.get(`${PASSCODE_PREFIX}${code}`);
  if (!raw) {
    return { valid: false };
  }

  try {
    const data = JSON.parse(raw);
    return { valid: true, userId: data.userId };
  } catch {
    return { valid: false };
  }
}

/**
 * Get the active passcode for a user (if any)
 * @param {string} userId
 * @returns {string|null}
 */
export async function getPasscodeForUser(userId) {
  return await redisClient.get(`${PASSCODE_PREFIX}user:${userId}`);
}

/**
 * Invalidate/consume a passcode after successful connection
 * @param {string} code
 */
export async function consumePasscode(code) {
  const raw = await redisClient.get(`${PASSCODE_PREFIX}${code}`);
  if (raw) {
    const data = JSON.parse(raw);
    await redisClient.del(`${PASSCODE_PREFIX}${code}`);
    await redisClient.del(`${PASSCODE_PREFIX}user:${data.userId}`);
    console.log(`[Passcode] Consumed code ${code}`);
  }
}

/**
 * Refresh a passcode (generate new one for same user)
 * @param {string} userId
 * @returns {{ code: string, expiresAt: number }}
 */
export async function refreshPasscode(userId) {
  // Delete old one
  const oldCode = await getPasscodeForUser(userId);
  if (oldCode) {
    await redisClient.del(`${PASSCODE_PREFIX}${oldCode}`);
    await redisClient.del(`${PASSCODE_PREFIX}user:${userId}`);
  }
  // Create new
  return await createPasscode(userId);
}

export default {
  createPasscode,
  verifyPasscode,
  getPasscodeForUser,
  consumePasscode,
  refreshPasscode,
};
