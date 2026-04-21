// netlify/functions/captain-login.js
// Email/password sign-in for captains. Validates that the email matches
// a team's captainEmail before issuing a session cookie.

import { createClient } from '@supabase/supabase-js';
import { buildCaptainCookie, findTeamByCaptainEmail } from './lib/captain-auth.js';

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const supabaseUrl = Netlify.env.get('SUPABASE_URL');
  const anonKey = Netlify.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !anonKey) {
    return json({ error: 'Supabase not configured' }, 500);
  }

  try {
    const { email, password } = await req.json();
    if (!email || !password) {
      return json({ error: 'Email and password required' }, 400);
    }

    // Check captain allowlist (email must be a team captain) BEFORE hitting Supabase
    const team = await findTeamByCaptainEmail(email.trim());
    if (!team) {
      return json({ error: 'Invalid credentials' }, 401);
    }

    const supabase = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data?.session) {
      return json({ error: 'Invalid credentials' }, 401);
    }

    return new Response(JSON.stringify({ ok: true, team: { id: team.id, name: team.name } }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': buildCaptainCookie(data.session.access_token),
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (err) {
    console.error('captain-login error:', err);
    return json({ error: 'Sign-in failed' }, 500);
  }
};

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}

export const config = { path: '/.netlify/functions/captain-login' };
