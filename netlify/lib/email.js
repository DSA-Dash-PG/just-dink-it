// netlify/lib/email.js
// Email sending via Resend (https://resend.com). Single dependency-free HTTP
// call — no Resend SDK needed, keeps the bundle small.
//
// Required env vars:
//   RESEND_API_KEY  — from https://resend.com/api-keys
//   FROM_EMAIL      — e.g. 'The Dink Society <noreply@dinksociety.com>'
//                     (must be a verified sender/domain in Resend)
//
// Optional:
//   SITE_URL        — used only for link rendering fallbacks

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

function env(name) {
  // Works in both Functions v1 (process.env) and v2 (Netlify.env.get)
  if (typeof Netlify !== 'undefined' && Netlify?.env?.get) {
    return Netlify.env.get(name) || process.env[name] || '';
  }
  return process.env[name] || '';
}

export async function sendEmail({ to, subject, html, text, from }) {
  const apiKey = env('RESEND_API_KEY');
  const fromAddr = from || env('FROM_EMAIL');

  if (!apiKey || !fromAddr) {
    // Don't throw — log and soft-succeed so dev envs without keys don't
    // break the magic-link flow. Production MUST have both vars set.
    console.warn('[email] Missing RESEND_API_KEY or FROM_EMAIL — email not sent', {
      to,
      subject,
    });
    return { sent: false, reason: 'missing_config' };
  }

  const payload = {
    from: fromAddr,
    to: Array.isArray(to) ? to : [to],
    subject,
    html,
  };
  if (text) payload.text = text;

  const res = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error('[email] Resend error', res.status, body);
    throw new Error(`Resend failed: ${res.status}`);
  }

  const data = await res.json().catch(() => ({}));
  return { sent: true, id: data.id || null };
}

// ---------- Templates ----------
// Dink Society palette: teal #0D3B40, gold #E8B542, cream #F5EBD4
// Fonts: we can't rely on web fonts in email clients, so we use a
// serif/sans stack that degrades gracefully.

const SERIF_STACK = `'Cormorant Garamond', Georgia, 'Times New Roman', serif`;
const SANS_STACK = `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`;

export function renderCaptainMagicLink(magicUrl, teamName) {
  const safeTeam = escapeHtml(teamName || 'Your team');
  const safeUrl = escapeAttr(magicUrl);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sign in to The Dink Society</title>
</head>
<body style="margin:0;padding:0;background:#F5EBD4;font-family:${SANS_STACK};color:#0D3B40;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5EBD4;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(13,59,64,0.08);">
          <tr>
            <td style="background:#0D3B40;padding:28px 32px;text-align:center;">
              <div style="font-family:${SERIF_STACK};font-size:28px;font-weight:600;color:#E8B542;letter-spacing:0.02em;">
                The Dink Society
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:36px 32px 24px 32px;">
              <h1 style="margin:0 0 16px 0;font-family:${SERIF_STACK};font-size:24px;font-weight:600;color:#0D3B40;">
                Sign in to ${safeTeam}
              </h1>
              <p style="margin:0 0 24px 0;font-size:15px;line-height:1.55;color:#333;">
                Tap the button below to sign in as captain. This link is good for 15 minutes and can only be used once.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
                <tr>
                  <td align="center" style="background:#E8B542;border-radius:4px;">
                    <a href="${safeUrl}" style="display:inline-block;padding:14px 28px;font-family:${SANS_STACK};font-size:15px;font-weight:600;color:#0D3B40;text-decoration:none;letter-spacing:0.02em;">
                      Sign in as captain
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:28px 0 0 0;font-size:13px;line-height:1.5;color:#666;">
                Or copy and paste this link into your browser:<br>
                <a href="${safeUrl}" style="color:#0D3B40;word-break:break-all;">${safeUrl}</a>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px 28px 32px;border-top:1px solid #F5EBD4;">
              <p style="margin:0;font-size:12px;line-height:1.5;color:#888;">
                If you didn't request this email, you can safely ignore it. Someone may have typed your address by mistake.
              </p>
            </td>
          </tr>
        </table>
        <p style="margin:20px 0 0 0;font-size:12px;color:#0D3B40;opacity:0.7;">
          The Dink Society · South Bay, CA
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ---------- Utils ----------
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(s) {
  return String(s).replace(/"/g, '&quot;');
}
