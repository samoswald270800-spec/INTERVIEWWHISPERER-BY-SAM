import crypto from 'crypto';
import { redisClient } from '../lib/redis.js';

const SESSION_PREFIX = 'camera_session:';
const ADMIN_PREFIX = 'camera_session_admin:';
const ID_PREFIX = 'camera_session_id:';
const CLAIM_PREFIX = 'camera_session_claim:';
const DEFAULT_TTL_SECONDS = 30 * 60;

function sessionTtlSeconds() {
  const requested = Number.parseInt(process.env.CAMERA_SESSION_TTL_SECONDS || '', 10);
  if (!Number.isFinite(requested)) return DEFAULT_TTL_SECONDS;
  return Math.max(5 * 60, Math.min(requested, 2 * 60 * 60));
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function writeSession(tokenHash, session, ttlSeconds) {
  await redisClient.set(`${SESSION_PREFIX}${tokenHash}`, JSON.stringify(session), { EX: ttlSeconds });
  await redisClient.set(`${ID_PREFIX}${session.id}`, tokenHash, { EX: ttlSeconds });
  await redisClient.set(`${ADMIN_PREFIX}${session.adminUserId}`, tokenHash, { EX: ttlSeconds });
}

export async function createCameraSession({ adminUserId, adminSocketId }) {
  await deleteCameraSessionForAdmin(adminUserId);

  const ttlSeconds = sessionTtlSeconds();
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashToken(token);
  const createdAt = Date.now();
  const session = {
    id: crypto.randomUUID(),
    adminUserId,
    adminSocketId,
    createdAt,
    expiresAt: createdAt + (ttlSeconds * 1000),
    guestId: null,
  };

  await writeSession(tokenHash, session, ttlSeconds);
  return { ...session, token };
}

export async function getCameraSession(token) {
  if (typeof token !== 'string' || token.length < 32 || token.length > 128) return null;
  const tokenHash = hashToken(token);
  const raw = await redisClient.get(`${SESSION_PREFIX}${tokenHash}`);
  if (!raw) return null;

  try {
    return { ...JSON.parse(raw), tokenHash };
  } catch {
    return null;
  }
}

export async function claimCameraSession(token, guestId) {
  if (typeof guestId !== 'string' || !/^[a-zA-Z0-9_-]{16,128}$/.test(guestId)) {
    return { ok: false, reason: 'invalid_guest' };
  }

  const session = await getCameraSession(token);
  if (!session || session.expiresAt <= Date.now()) return { ok: false, reason: 'expired' };
  const ttlSeconds = await redisClient.ttl(`${SESSION_PREFIX}${session.tokenHash}`);
  if (ttlSeconds <= 0) return { ok: false, reason: 'expired' };

  const claimKey = `${CLAIM_PREFIX}${session.tokenHash}`;
  let claimedGuestId = await redisClient.get(claimKey);
  if (!claimedGuestId) {
    const claimed = await redisClient.set(claimKey, guestId, { NX: true, EX: ttlSeconds });
    claimedGuestId = claimed ? guestId : await redisClient.get(claimKey);
  }
  if (claimedGuestId !== guestId) return { ok: false, reason: 'claimed' };
  session.guestId = guestId;

  return { ok: true, session };
}

export async function deleteCameraSessionById(sessionId) {
  const tokenHash = await redisClient.get(`${ID_PREFIX}${sessionId}`);
  if (!tokenHash) return false;

  const raw = await redisClient.get(`${SESSION_PREFIX}${tokenHash}`);
  let session = null;
  try { session = raw ? JSON.parse(raw) : null; } catch { /* invalid data is deleted below */ }

  const keys = [`${SESSION_PREFIX}${tokenHash}`, `${ID_PREFIX}${sessionId}`, `${CLAIM_PREFIX}${tokenHash}`];
  if (session?.adminUserId) keys.push(`${ADMIN_PREFIX}${session.adminUserId}`);
  await redisClient.del(keys);
  return true;
}

export async function deleteCameraSessionForAdmin(adminUserId) {
  const tokenHash = await redisClient.get(`${ADMIN_PREFIX}${adminUserId}`);
  if (!tokenHash) return false;

  const raw = await redisClient.get(`${SESSION_PREFIX}${tokenHash}`);
  let session = null;
  try { session = raw ? JSON.parse(raw) : null; } catch { /* invalid data is deleted below */ }

  const keys = [`${ADMIN_PREFIX}${adminUserId}`, `${SESSION_PREFIX}${tokenHash}`, `${CLAIM_PREFIX}${tokenHash}`];
  if (session?.id) keys.push(`${ID_PREFIX}${session.id}`);
  await redisClient.del(keys);
  return true;
}

export default {
  createCameraSession,
  getCameraSession,
  claimCameraSession,
  deleteCameraSessionById,
  deleteCameraSessionForAdmin,
};
