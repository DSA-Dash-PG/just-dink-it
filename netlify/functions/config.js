// netlify/functions/config.js
// Exposes public configuration (Supabase URL + anon key, admin email list)
// These are safe to share with the browser - the anon key has no special privileges.

import { ok, cors } from '../lib/response.js';

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return cors();
  return ok({
    supabaseUrl: process.env.SUPABASE_URL || null,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || null,
    adminEmails: (process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim()).filter(Boolean),
  });
};
