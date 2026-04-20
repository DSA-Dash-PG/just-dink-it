// public/js/supabase-client.js
// Initializes the Supabase client for the browser.
//
// Public env vars (URL + anon key) are injected at build time via /api/config
// so we don't have to hardcode them. The anon key is safe to expose.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

let _supabase = null;
let _configPromise = null;

async function loadConfig() {
  if (_configPromise) return _configPromise;
  _configPromise = fetch('/api/config').then(r => r.json());
  return _configPromise;
}

export async function getSupabase() {
  if (_supabase) return _supabase;
  const config = await loadConfig();
  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    throw new Error('Supabase not configured. Check Netlify env vars: SUPABASE_URL, SUPABASE_ANON_KEY');
  }
  _supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
      flowType: 'pkce',
    },
  });
  return _supabase;
}

export async function getSession() {
  const supabase = await getSupabase();
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function getCurrentUser() {
  const session = await getSession();
  return session?.user || null;
}

export async function getAccessToken() {
  const session = await getSession();
  return session?.access_token || null;
}

// Sign out and reload
export async function signOut() {
  const supabase = await getSupabase();
  await supabase.auth.signOut();
  window.location.reload();
}

// Subscribe to auth changes (login, logout, token refresh)
export async function onAuthChange(callback) {
  const supabase = await getSupabase();
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    callback(session?.user || null, event);
  });
  return data.subscription;
}

// Check if user is admin (mirrors backend logic)
// Admin emails are stored client-side too for UI gating, but the backend is the real check.
let _adminEmails = null;
async function getAdminEmails() {
  if (_adminEmails) return _adminEmails;
  const config = await loadConfig();
  _adminEmails = (config.adminEmails || []).map(e => e.toLowerCase());
  return _adminEmails;
}

export async function isAdmin(user) {
  if (!user?.email) return false;
  const admins = await getAdminEmails();
  return admins.includes(user.email.toLowerCase()) ||
         user.user_metadata?.role === 'admin' ||
         user.app_metadata?.role === 'admin';
}
