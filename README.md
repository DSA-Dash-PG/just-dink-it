# Just Dink It — South Bay Pickleball League

A modern league management site for the South Bay's premier pickleball league. Built on Netlify with Blobs storage, Functions for the API, Supabase Auth, and Stripe for payments.

## Stack

- **Hosting:** Netlify (static + Functions)
- **Database:** Netlify Blobs (key-value, one per entity type)
- **Auth:** Supabase Auth (email + password, Google OAuth)
- **Payments:** Stripe
- **Frontend:** Plain HTML/CSS/JS with ES modules
- **Fonts:** Inter + Cormorant Garamond (Google Fonts)

## Auth model

Auth is handled by **Supabase** (separate project from SBPL). Two roles:

- **Admin** — identified by email matching the `ADMIN_EMAILS` env var (comma-separated list). Has full access to `/admin.html`.
- **Captain** — identified by email matching a team's captain email. Auto-assigned: any authenticated user who signs up with an email that matches a registered team captain is treated as that team's captain. Access via `/captain.html`.

There's no invitation flow — captains just sign up normally with the same email they used when registering their team.

---

## Setup: Supabase (do this first — ~10 minutes)

### 1. Create the Supabase project

1. Go to https://supabase.com/dashboard
2. Click **New project**
3. Name: `just-dink-it`
4. Database password: generate and save somewhere (not needed for the app, but Supabase requires it)
5. Region: **West US (North California)** — closest to LA
6. Pricing: Free tier
7. Click **Create new project** — takes ~2 min to provision

### 2. Get your API credentials

Once the project finishes provisioning:

1. Left sidebar → **Project Settings** (gear icon) → **API**
2. Copy these three values:
   - **Project URL** → env var `SUPABASE_URL`
   - **`anon` `public` key** → env var `SUPABASE_ANON_KEY` (safe to expose to browser)
   - **`service_role` `secret` key** → env var `SUPABASE_SERVICE_ROLE_KEY` (NEVER put in frontend code)

### 3. Enable Google OAuth

1. Supabase left sidebar → **Authentication** → **Providers**
2. Find **Google**, toggle on
3. Copy the **Callback URL** shown (looks like `https://abcdefgh.supabase.co/auth/v1/callback`)
4. **In a new tab**, go to https://console.cloud.google.com
5. Create a new project named "Just Dink It"
6. Search **OAuth consent screen** → **External** → Create
   - App name: `Just Dink It`
   - User support email + developer email: your email
   - Save and continue through all screens
7. Go to **APIs & Services → Credentials**
8. **Create Credentials** → **OAuth client ID**
   - Application type: **Web application**
   - Name: `Just Dink It Web`
   - **Authorized redirect URIs**: paste the Callback URL from Supabase
   - Create
9. Copy the **Client ID** and **Client Secret**
10. Back in Supabase → Google provider config → paste both → Save

### 4. Configure Auth URLs

1. Supabase → **Authentication** → **URL Configuration**
2. **Site URL**: your Netlify site URL (e.g. `https://just-dink-it.netlify.app`)
3. **Redirect URLs**: add both:
   - `https://just-dink-it.netlify.app/**`
   - `http://localhost:8888/**` (for local dev)
4. Save

### 5. Disable email confirmation (optional, recommended for testing)

1. Supabase → **Authentication** → **Providers** → **Email**
2. Toggle off **Confirm email** (so new signups work immediately)
3. For production later, turn this back on and configure a real SMTP sender (SendGrid, etc.)

---

## Setup: Netlify

### 1. Deploy

1. Push this repo to GitHub (`DSA-Dash-PG/just-dink-it` matches your naming pattern)
2. In Netlify dashboard, **Add new site** → **Import from Git** → select the repo
3. Build settings auto-detected from `netlify.toml`
4. Deploy

### 2. Set environment variables

In Netlify dashboard → Site configuration → **Environment variables**, add:

| Name | Value |
|------|-------|
| `SUPABASE_URL` | Your Supabase Project URL |
| `SUPABASE_ANON_KEY` | Your Supabase anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Your Supabase service_role/secret key |
| `ADMIN_EMAILS` | `richardhak@gmail.com` (add more comma-separated later) |
| `STRIPE_SECRET_KEY` | Stripe secret key (optional until you take payments) |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret (optional) |

After adding env vars, trigger a new deploy (Deploys → Trigger deploy) so functions pick them up.

### 3. Stripe webhook (only when you're ready to take payments)

1. Stripe dashboard → Developers → Webhooks → **Add endpoint**
2. URL: `https://YOUR-SITE.netlify.app/.netlify/functions/stripe-webhook`
3. Events: `checkout.session.completed`
4. Copy the signing secret → Netlify env var `STRIPE_WEBHOOK_SECRET`

---

## First login

1. Visit `https://YOUR-SITE.netlify.app/admin.html`
2. Click **Sign in** → switch to **Create account** tab
3. Sign up with the email that's in your `ADMIN_EMAILS` env var
4. Or click **Continue with Google** if you want Google sign-in

If email confirmation is disabled in Supabase (step 5 above), you'll be signed in immediately.

## First season setup

In the admin dashboard:

1. **Seasons & Divisions** tab → click the big coral **⚡ Seed mock season** button for a fully-populated demo
2. Or manually: create a season → create divisions → wait for registrations

## Captain onboarding (real flow)

1. Captain fills out `/register.html`
2. Admin approves in Registrations tab
3. System creates the team + a player record with the captain's email
4. Captain visits `/captain.html` → clicks Sign in → uses **the same email** from their registration
5. They automatically have captain access to their team

---

## Reset & seed

From the admin dashboard (Seasons & Divisions tab):

- **⚡ Seed mock season** — creates 1 season, 6 teams, 6-12 players per team, ~15 matches (some finalized), 4 sponsors
- **⚠ Reset everything** (danger zone at bottom) — wipes all data. Two-step confirmation (type `DELETE EVERYTHING`).

---

## Local development

```bash
npm install
npm install -g netlify-cli
netlify login
netlify link              # connect to your site (pulls env vars)
netlify dev               # runs at http://localhost:8888
```

`netlify dev` automatically pulls env vars from your linked Netlify site, so local dev works with real Supabase + Blobs.

---

## Architecture notes

- **No database migrations.** Netlify Blobs is schemaless; the data layer in `db.js` is the single source of truth for structure.
- **Career stats are denormalized** onto the player record so profile pages load fast. Recomputed when a match is finalized.
- **Both-captain score agreement** — `scores.js` tracks submissions from both teams; match goes to `final` only if scores match, `disputed` otherwise (admin resolves).
- **Pretty URLs** via Netlify redirects: `/teams/pier-pressure`, `/players/jane-smith-abc1`.
- **Supabase for auth only** — all app data lives in Netlify Blobs. Keeps you on free tiers longer.
- **Admin identity via env var** — `ADMIN_EMAILS` is the canonical source of truth for who's an admin. No DB mutation needed to add/remove admins; just update the env var and redeploy.

## Things to add later

- Email notifications (SendGrid or Supabase SMTP for registration confirmations)
- Photo upload via Netlify Blobs file storage or Supabase Storage
- Custom domain (`justdinkit.com`)
- Head-to-head matrix and MVP race on the stats page
- Bracket builder for playoffs
- Sponsor logos on homepage + footer
- Email captain when their registration is approved
- Mobile push notifications for match reminders

---

Built with care for the South Bay pickleball community.
