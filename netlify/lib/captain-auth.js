// netlify/lib/captain-auth.js
// Magic-link auth for team captains. Separate from Supabase (which is used
// for admins). Flow:
//   1. Captain submits email       → captain-login.js
//   2. We issue a single-use token → createMagicToken()
//   3. Captain clicks emailed link → captain-link.js
//   4. Token is consumed           → consumeMagicToken()
//   5. Session cookie is set       → createSession() + buildCaptainCookie()
//   6. Subsequent requests         → requireCaptain() reads the cookie
//
// Storage: Netlify Blobs (no Supabase tables). Tokens live in `captain-tokens`,
// sessions in `captain-sessions`. Both have short TTLs and are single-purpose.

import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';
import { teams, players, roster } from './db.js';

// ---------- Config ----------
const TOKEN_TTL_MS = 15 * 60 * 1000;            // 15 minutes to click the link
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days logged in
const COOKIE_NAME = 'ds_captain';

// ---------- Stores (lazy, so imports don't crash at module load) ----------
const tokensStore = () => getStore('captain-tokens');
const sessionsStore = () => getStore('captain-sessions');

// ---------- Helpers ----------
function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function now() {
  return Date.now();
}

// Extract cookie value from a Request (Functions v2) or event (v1)
function readCookie(reqOrEvent, name) {
  const headerVal =
    reqOrEvent?.headers?.get?.('cookie') ??      // v2 Request
    reqOrEvent?.headers?.cookie ??                // v1 lowercase
    reqOrEvent?.headers?.Cookie ??                // v1 uppercase
    '';
  if (!headerVal) return null;
  const parts = headerVal.split(';').map((s) => s.trim());
  for (const p of parts) {
    const eq = p.indexOf('=');
    if (eq === -1) continue;
    if (p.slice(0, eq) === name) return decodeURIComponent(p.slice(eq + 1));
  }
  return null;
}

// Resolve captain email for a team. Works whether the team doc stores
// `captainEmail` directly (denormalized) or only `captainId` (requires a
// players lookup). Returns lowercased email or null.
async function resolveCaptainEmail(team) {
  if (!team) return null;
  if (team.captainEmail) return String(team.captainEmail).toLowerCase();
  if (team.captainId) {
    const captain = await players.get(team.captainId).catch(() => null);
    if (captain?.email) return String(captain.email).toLowerCase();
  }
  return null;
}

// ---------- Magic tokens ----------
export async function createMagicToken(email, teamId) {
  const token = randomToken(32);
  const record = {
    email: String(email).toLowerCase(),
    teamId,
    createdAt: now(),
    expiresAt: now() + TOKEN_TTL_MS,
    used: false,
  };
  await tokensStore().setJSON(token, record);
  return token;
}

// Consumes a token: returns { email, teamId } on first use, null otherwise.
// Deletes the token so it can't be reused.
export async function consumeMagicToken(token) {
  if (!token) return null;
  const store = tokensStore();
  const record = await store.get(token, { type: 'json' }).catch(() => null);
  if (!record) return null;
  if (record.used) return null;
  if (record.expiresAt < now()) {
    await store.delete(token).catch(() => {});
    return null;
  }
  // Single-use: delete immediately
  await store.delete(token).catch(() => {});
  return { email: record.email, teamId: record.teamId };
}

// ---------- Team lookups ----------
export async function getTeamById(teamId) {
  if (!teamId) return null;
  return teams.get(teamId).catch(() => null);
}

// Find the team whose captain email matches. Prefers denormalized
// team.captainEmail; falls back to players lookup + team scan.
export async function findTeamByCaptainEmail(email) {
  if (!email) return null;
  const normalized = String(email).toLowerCase();

  // Fast path: scan teams and check the denormalized field if present
  const all = await teams.list().catch(() => []);
  const direct = all.find(
    (t) => t.captainEmail && String(t.captainEmail).toLowerCase() === normalized
  );
  if (direct) return direct;

  // Fallback: look up the player by email, then find a team whose captainId matches
  const captain = await players.getByEmail(normalized).catch(() => null);
  if (!captain) return null;
  return all.find((t) => t.captainId === captain.id) || null;
}

// ---------- Sessions ----------
export async function createSession(team, email) {
  const sessionId = randomToken(32);
  const record = {
    email: String(email).toLowerCase(),
    teamId: team.id,
    createdAt: now(),
    expiresAt: now() + SESSION_TTL_MS,
  };
  await sessionsStore().setJSON(sessionId, record);
  return sessionId;
}

export function buildCaptainCookie(sessionId) {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  return [
    `${COOKIE_NAME}=${encodeURIComponent(sessionId)}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ].join('; ');
}

export function buildCaptainLogoutCookie() {
  return [
    `${COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    'Max-Age=0',
  ].join('; ');
}

// Reads the captain session cookie and returns the stored record, or null.
async function readSession(reqOrEvent) {
  const sessionId = readCookie(reqOrEvent, COOKIE_NAME);
  if (!sessionId) return null;
  const store = sessionsStore();
  const record = await store.get(sessionId, { type: 'json' }).catch(() => null);
  if (!record) return null;
  if (record.expiresAt < now()) {
    await store.delete(sessionId).catch(() => {});
    return null;
  }
  return { sessionId, ...record };
}

// Hydrate team with its current roster for convenience in callers like
// captain-lineup.js, which expects team.roster to be an array of player objects.
async function hydrateTeamRoster(team) {
  if (!team) return team;
  const entries = await roster.listByTeam(team.seasonId, team.id).catch(() => []);
  const rosterPlayers = await Promise.all(
    entries.map(async (r) => {
      const p = await players.get(r.playerId).catch(() => null);
      if (!p) return null;
      return {
        id: p.id,
        name: p.name || [p.firstName, p.lastName].filter(Boolean).join(' '),
        firstName: p.firstName || null,
        lastName: p.lastName || null,
        nickname: p.nickname || null,
        gender: p.sex || p.gender || null, // lineup validator reads .gender
        email: p.email || null,
      };
    })
  );
  return { ...team, roster: rosterPlayers.filter(Boolean) };
}

// ---------- Gate ----------
// Returns { user: { email }, team: <hydrated> } on success, null on failure.
// Callers pair with unauthResponse() to send a 401.
export async function requireCaptain(reqOrEvent) {
  const session = await readSession(reqOrEvent);
  if (!session) return null;

  const team = await getTeamById(session.teamId);
  if (!team) return null;

  // Re-verify the captain still owns this team (email hasn't changed)
  const currentCaptainEmail = await resolveCaptainEmail(team);
  if (!currentCaptainEmail || currentCaptainEmail !== session.email) {
    // Stale session — invalidate it
    await sessionsStore().delete(session.sessionId).catch(() => {});
    return null;
  }

  const hydrated = await hydrateTeamRoster(team);
  return {
    user: { email: session.email },
    team: hydrated,
    sessionId: session.sessionId,
  };
}

export function unauthResponse(message = 'Unauthorized') {
  return new Response(JSON.stringify({ error: message }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Explicit logout: deletes session and returns a clearing cookie
export async function destroySession(reqOrEvent) {
  const session = await readSession(reqOrEvent);
  if (session) {
    await sessionsStore().delete(session.sessionId).catch(() => {});
  }
  return buildCaptainLogoutCookie();
}
