// netlify/lib/supabase-auth.js
// Verifies Supabase JWTs sent from the frontend and resolves user identity.
// Replaces the old Netlify Identity auth in db.js.

import { createClient } from '@supabase/supabase-js';
import { teams, players } from './db.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);

// Lazy-loaded admin client (uses service_role key, full DB access)
let _adminClient = null;
function getAdminClient() {
  if (!_adminClient) {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars required');
    }
    _adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return _adminClient;
}

// Extract bearer token from Authorization header
function extractToken(event) {
  const auth = event.headers?.authorization || event.headers?.Authorization || '';
  if (!auth.startsWith('Bearer ')) return null;
  return auth.slice(7);
}

// Verify the JWT and return the user, or null if invalid
export async function verifyUser(event) {
  const token = extractToken(event);
  if (!token) return null;

  try {
    const supabase = getAdminClient();
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) return null;
    return data.user;
  } catch {
    return null;
  }
}

// Is this user an admin? Two ways:
//   1. Their email is in ADMIN_EMAILS env var (the canonical source)
//   2. user_metadata.role === 'admin' (set via Supabase dashboard)
export function isAdmin(user) {
  if (!user) return false;
  const email = (user.email || '').toLowerCase();
  if (ADMIN_EMAILS.includes(email)) return true;
  const role = user.user_metadata?.role || user.app_metadata?.role;
  return role === 'admin';
}

// Resolve which team this user is captain of, if any.
// Captain match is by email: a user is captain of any team where the linked
// player record has the same email as the authenticated user.
export async function findCaptainTeam(user) {
  if (!user?.email) return null;
  const email = user.email.toLowerCase();
  const captainPlayer = await players.getByEmail(email);
  if (!captainPlayer) return null;
  const allTeams = await teams.list();
  const myTeams = allTeams.filter(t => t.captainId === captainPlayer.id);
  return { player: captainPlayer, teams: myTeams };
}

// Combined gate helpers
export async function requireUser(event) {
  const user = await verifyUser(event);
  if (!user) throw new Error('UNAUTHORIZED');
  return user;
}

export async function requireAdmin(event) {
  const user = await requireUser(event);
  if (!isAdmin(user)) throw new Error('UNAUTHORIZED');
  return user;
}
