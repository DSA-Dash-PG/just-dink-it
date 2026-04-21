// netlify/functions/captain-logout.js
import { buildClearCaptainCookie } from './lib/captain-auth.js';

export default async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': buildClearCaptainCookie(),
    },
  });
};

export const config = { path: '/.netlify/functions/captain-logout' };
