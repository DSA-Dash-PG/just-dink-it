// netlify/functions/lib/captain-auth.js
// Validates a Supabase session and returns { user, teamId } for a captain.
// A captain is a Supabase user whose email matches a team's captainEmail.

import { createClient } from '@supabase/supabase-js';
import { getStore } from '@netlify/blobs';

const COOKIE_NAME = 'ds_captain_session';

export function getCaptainToken(req) {
  const cookieHeader = req.headers.get('cookie') || '';
  const match = cookieHeader.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export function buildCaptainCookie(token, { maxAge = 60 * 60 * 24 * 30 } = {}) {
  return [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/', 'HttpOnly', 'Secure', 'SameSite=Strict',
    `Max-Age=${maxAge}`,
  ].join('; ');
}

export function buildClearCaptainCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

/**
 * Returns { user, team } if the request has a valid captain session
 * whose email is the captain of a team. Null otherwise.
 */
export async function requireCaptain(req) {
  const token = getCaptainToken(req);
  if (!token) return null;

  const supabaseUrl = Netlify.env.get('SUPABASE_URL');
  const serviceKey = Netlify.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) return null;

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;

  const email = (data.user.email || '').toLowerCase();
  const team = await findTeamByCaptainEmail(email);
  if (!team) return null;

  return { user: { id: data.user.id, email: data.user.email }, team };
}

/** Looks up a team by captain email across the teams store. */
export async function findTeamByCaptainEmail(email) {
  const normalized = email.toLowerCase();
  const store = getStore('teams');
  const { blobs } = await store.list({ prefix: 'team/' });
  for (const b of blobs) {
    const team = await store.get(b.key, { type: 'json' });
    if (team && (team.captainEmail || '').toLowerCase() === normalized) {
      return team;
    }
  }
  return null;
}

export function unauthResponse() {
  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}
