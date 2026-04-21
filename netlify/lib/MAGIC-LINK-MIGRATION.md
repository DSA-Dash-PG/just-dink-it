# Captain auth → Magic link (no Supabase)

Replaces the Supabase-based captain auth with a self-contained magic-link flow. Simpler to operate, better UX for captains, no per-captain account creation.

---

## What changed

### Before
- Captain = Supabase user with password
- Manually create each captain in Supabase dashboard
- Coordinate temp passwords out of band
- Captain signs in with email + password

### Now
- Captain = any email that matches a team's `captainEmail` field
- No per-captain account creation needed — just populate teams
- Captain enters email → gets a one-tap sign-in link → done
- Sessions stored in Netlify Blobs (`captain-sessions` store), not Supabase

### Admin portal is unchanged
Admins still use Supabase auth. That's the right fit there — small fixed set of accounts, password + session management makes sense. Only captain auth switched.

---

## Files changed

| File                      | Change                                                                 |
|---------------------------|------------------------------------------------------------------------|
| `lib/captain-auth.js`     | **Rewritten.** No Supabase. Magic-link tokens + session blob storage.  |
| `captain-login.js`        | **Rewritten.** Accepts email only, sends magic-link email via Resend.  |
| `captain-link.js`         | **New.** Consumes the magic-link token, creates session, redirects.    |
| `captain-whoami.js`       | Unchanged contract; now uses magic-link session under the hood.        |
| `captain-logout.js`       | Now deletes the server-side session, not just the cookie.              |
| `lib/email.js`            | Added `renderCaptainMagicLink(magicUrl, teamName)` template export.    |
| `captain.html`            | Login form now email-only; shows "check your inbox" state; handles auth-error URL params. |

---

## New Blobs stores

```
captain-tokens/token/<token>.json    — { token, email, teamId, expiresAt } — 15-min magic-link tokens
captain-sessions/session/<id>.json   — { id, teamId, email, expiresAt }    — 30-day sessions
```

No schema migrations needed for the `teams` store. Just make sure each team has `captainEmail` set.

---

## Security properties

- **No enumeration**: `/captain-login` always returns the same generic message regardless of whether the email matches a captain. A 300ms artificial delay on miss keeps response times uniform, so attackers can't time-probe either.
- **Single-use tokens**: Magic link is deleted on first use. Clicking a link twice = the second click redirects to `?error=invalid`.
- **Short expiry**: Tokens expire in 15 minutes. Sessions last 30 days.
- **HttpOnly cookie**: Session cookie is inaccessible to JavaScript, so XSS can't steal it.
- **Server-side session revocation**: `captain-logout` deletes the session blob. Revoking a cookie that's still referenced in a stolen copy doesn't help; deleting server-side does.
- **Captain email binding**: `requireCaptain` re-verifies on every request that the session's email still matches the team's current `captainEmail`. If you change the captain email admin-side, old sessions become invalid immediately.

---

## Env vars

Removes the need for `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` for captain flow (admins still need them).

Requires (already in place from earlier drops):
- `RESEND_API_KEY`
- `EMAIL_FROM`
- `SITE_URL` — **used in the magic-link URL construction**. If missing, falls back to `https://dinksociety.netlify.app`.

Double-check `SITE_URL` is set correctly — if the magic link points at the wrong domain, the whole flow breaks. Value should be the origin only, no trailing slash, e.g. `https://dinksociety.netlify.app`.

---

## Operator workflow

**To onboard a captain:**
1. Create the team record in the `teams` Blobs store with `captainEmail` set to the captain's email.
2. Tell the captain to go to `https://dinksociety.netlify.app/captain.html` and enter their email.
3. They get an email, tap the button, they're in.

That's it. No password coordination, no Supabase user creation, no manual steps per captain.

**To change a captain mid-Circuit:**
1. Update the team's `captainEmail` in the `teams` store.
2. Old captain's session becomes invalid on their next request (auto-logs them out).
3. New captain visits `/captain.html`, requests a link, signs in.

**To revoke a captain:**
1. Update the team's `captainEmail` to something that doesn't match a real person (or null it out).
2. Their existing session immediately stops working.

---

## Known caveats

- **Captain accidentally uses a different email**: If they registered with `cap@work.com` but try to sign in with `cap@personal.com`, they'll just get the generic "check your inbox" response and no email will arrive. The UX doesn't tell them why. Acceptable trade-off for the anti-enumeration guarantee — if they're confused, they'll ask you directly and you can point them at the right address.
- **No email = no access**: If a captain loses access to their email account, you have to update the `captainEmail` field admin-side. There's no captain-driven recovery flow.
- **Magic link is bearer-token**: Anyone with the URL before it's consumed can sign in. 15-minute expiry + single-use consumption contains the blast radius, but don't forward captain links in shared Slack channels.
