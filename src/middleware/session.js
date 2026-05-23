/**
 * Session Middleware Configuration
 */

import session from 'express-session';
import config from '../config/index.js';
import { createSessionStore } from '../lib/redis.js';

/**
 * Create session middleware
 */
export function createSessionMiddleware() {
  const store = createSessionStore();

  return session({
    store,
    secret: config.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    proxy: true, // Required for Render/Heroku/Railway
    cookie: {
      maxAge: config.SESSION_TTL_MS,
      httpOnly: true,
      sameSite: 'strict',
      secure: config.IS_PRODUCTION,
    },
  });
}

/**
 * Post-auth middleware to capture IP/loginAt
 */
export function sessionAnnotator(req, _res, next) {
  if (req.session && !req.session.loginAt) {
    req.session.loginAt = Date.now();
  }
  if (req.session && !req.session.ip) {
    req.session.ip = req.headers['x-forwarded-for'] || req.ip;
  }
  next();
}

/**
 * Generate device fingerprint
 */
export function getDeviceFingerprint(req) {
  const ip = req.headers['x-forwarded-for'] || req.ip || 'unknown';
  const userAgent = req.headers['user-agent'] || 'unknown';
  return `${ip}|${userAgent}`;
}

export default {
  createSessionMiddleware,
  sessionAnnotator,
  getDeviceFingerprint,
};

