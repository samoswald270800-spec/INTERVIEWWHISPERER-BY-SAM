/**
 * Supabase Client
 */

import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import config from '../config/index.js';

let supabase = null;

export function initSupabase() {
  if (config.SUPABASE_URL && config.SUPABASE_KEY) {
    supabase = createSupabaseClient(
      config.SUPABASE_URL,
      config.SUPABASE_KEY
    );
    console.log('✅ Supabase client initialized');
  } else {
    console.log('ℹ️  Supabase not configured (multi-tenant features disabled)');
  }
  return supabase;
}

export function getSupabase() {
  return supabase;
}

export { supabase };
export default supabase;

