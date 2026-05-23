/**
 * Centralized Configuration
 * All environment variables and constants in one place
 */

import 'dotenv/config';

// Server
export const PORT = process.env.PORT || 3000;
export const HOST = '0.0.0.0';
export const NODE_ENV = process.env.NODE_ENV || 'development';
export const IS_PRODUCTION = NODE_ENV === 'production';

// Session
export const SESSION_SECRET = process.env.SESSION_SECRET;
export const SESSION_TTL_HOURS = 6;
export const SESSION_TTL_MS = SESSION_TTL_HOURS * 60 * 60 * 1000;

// Redis
export const REDIS_URL = process.env.REDIS_URL;
export const REDIS_USE_TLS = REDIS_URL?.startsWith('rediss://');

// Supabase
export const SUPABASE_URL = process.env.SUPABASE_URL;
export const SUPABASE_KEY = process.env.SUPABASE_KEY;

// OpenAI
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Anthropic
export const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';

// Super Admin (ENV-based auth only)
export const SUPER_ADMIN_USERNAME = process.env.SUPER_ADMIN_USERNAME;
export const SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD;

// Legacy Admin (for backward compatibility)
export const ADMIN_USER = process.env.ADMIN_USER || '';
export const ADMIN_PASS = process.env.ADMIN_PASS || '';

// Rate Limiting
export const ANALYZE_COOLDOWN_MS = 20000; // 20 seconds between requests
export const ANALYZE_DAILY_LIMIT = 50;

// Credits
export const TOKENS_PER_HOUR = 10;         // 10 tokens = 1 hour (1 token = 6 mins)
export const MIN_CHARGE_MINUTES = 6;       // Minimum 6 minutes charge
export const MIN_CHARGE_TOKENS = 1;         // 6 mins = 1 tokens
export const SCREEN_ANALYSIS_COST = 1;      // 1 token per screen analysis

// Validate required env vars
export function validateConfig() {
  const errors = [];

  if (!REDIS_URL) errors.push('REDIS_URL is required');
  if (!OPENAI_API_KEY) errors.push('OPENAI_API_KEY is required');
  if (!SESSION_SECRET) errors.push('SESSION_SECRET is required — generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');

  if (errors.length > 0) {
    console.error('❌ Configuration errors:');
    errors.forEach(e => console.error(`   - ${e}`));
    process.exit(1);
  }
}

export default {
  PORT,
  HOST,
  NODE_ENV,
  IS_PRODUCTION,
  SESSION_SECRET,
  SESSION_TTL_HOURS,
  SESSION_TTL_MS,
  REDIS_URL,
  REDIS_USE_TLS,
  SUPABASE_URL,
  SUPABASE_KEY,
  OPENAI_API_KEY,
  ANTHROPIC_API_KEY,
  SUPER_ADMIN_USERNAME,
  SUPER_ADMIN_PASSWORD,
  ADMIN_USER,
  ADMIN_PASS,
  ANALYZE_COOLDOWN_MS,
  ANALYZE_DAILY_LIMIT,
  TOKENS_PER_HOUR,
  MIN_CHARGE_MINUTES,
  MIN_CHARGE_TOKENS,
  SCREEN_ANALYSIS_COST,
  validateConfig,
};

