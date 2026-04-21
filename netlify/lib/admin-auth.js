// netlify/lib/admin-auth.js
// Thin wrapper around supabase-auth.js that exposes the shape
// admin-generate-schedule.js (and future admin Functions v2) expect:
// a Request-based gate that returns a context object or null, plus a
// matching unauthResponse().

import { requireAdmin as _requireAdminFromEvent } from './supabase-auth.js';

// Accepts either a Functions v2 Request or a v1 event. Normalizes to a shape
// that supabase-auth.js's extractToken can read.
function toEventShape(reqOrEvent) {
  if (!reqOrEvent) return { headers: {} };
  // Already an event-like object with plain headers
  if (reqOrEvent.headers && typeof reqOrEvent.headers.get !== 'function') {
    return reqOrEvent;
  }
  // Functions v2 Request: flatten Headers to a plain object
  const out = {};
  if (reqOrEvent.headers?.forEach) {
    reqOrEvent.headers.forEach((value, key) => {
      out[key.toLowerCase()] = value;
    });
  }
  return { headers: out };
}

// Returns { user } on success, null on failure.
export async function requireAdmin(reqOrEvent) {
  try {
    const user = await _requireAdminFromEvent(toEventShape(reqOrEvent));
    return { user };
  } catch {
    return null;
  }
}

export function unauthResponse(message = 'Unauthorized') {
  return new Response(JSON.stringify({ error: message }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}
