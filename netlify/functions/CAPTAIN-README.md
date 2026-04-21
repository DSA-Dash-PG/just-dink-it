# Captain portal + lineup reveal system

Adds a full captain-facing workflow to The Dink Society: pre-Circuit roster setup, per-match lineup building with strict gender-slot enforcement, and a hidden simultaneous reveal (both captains must lock before either sees the other's picks).

---

## The flow

1. **Pre-Circuit**: Admin generates the round-robin schedule via `admin-generate-schedule.js`. Captain signs into `/captain.html` and adds team roster (players with gender, optional email/phone/DUPR).
2. **Before a match**: Captain picks players for all 12 game slots (6 per round × 2 rounds). Drafts save freely.
3. **Captain locks**: The lineup freezes. Captain sees their own picks + "Waiting on opponent."
4. **Opponent locks**: Page auto-refreshes (polls every 15s), full reveal appears for both captains side-by-side.
5. **During play**: Scores entered via admin portal (not yet captain-facing — see "What's next" below).

Nothing leaks before both locks: captain only sees opponent's team name + court assignment, nothing else.

---

## Data model

```
Blobs store: teams
  team/<teamId>.json
    { id, name, captainEmail, circuit, division, roster: [{id, name, gender, email?, phone?, dupr?}, ...] }

Blobs store: schedule            (already existed)
  schedule/<circuit>/<division>/week-<N>.json
    { circuit, division, week, matches: [{ id, teamA, teamB, court, scoreA, scoreB, ... }] }

Blobs store: lineups             (new)
  lineup/<matchId>/<teamId>.json
    { matchId, teamId, teamName, games: { r1g1: {p1, p2, p1Name, p2Name}, ... },
      updatedAt, updatedBy, lockedAt, lockedBy }
```

Reveal rule: `lineup/<matchId>/<teamA>.json.lockedAt` AND `lineup/<matchId>/<teamB>.json.lockedAt` both set → reveal unlocked.

---

## File placement

```
dinksociety/
├── captain.html                                    ← NEW
└── netlify/
    └── functions/
        ├── lib/
        │   └── captain-auth.js                     ← NEW
        ├── captain-login.js                        ← NEW
        ├── captain-logout.js                       ← NEW
        ├── captain-whoami.js                       ← NEW
        ├── captain-roster.js                       ← NEW (GET, PUT)
        ├── captain-schedule.js                     ← NEW
        ├── captain-lineup.js                       ← NEW (GET, PUT with action=save|lock)
        └── admin-generate-schedule.js              ← NEW (admin-only)
```

---

## Setup steps

### 1. Create team records

Each team needs a `team/<teamId>.json` in the `teams` Blobs store before the captain can sign in. Populate these once registration closes. Minimum fields:

```json
{
  "id": "t_salty",
  "name": "Salty Servers",
  "captainEmail": "captain@example.com",
  "circuit": "I",
  "division": "3.5M",
  "roster": []
}
```

`captainEmail` is the matching key for captain sessions. The captain must also exist as a Supabase user with the same email.

**Quick way to seed teams for Circuit I**: write a one-off Node script that reads confirmed registrations from `registrations/confirmed/*.json`, derives a team ID from the team name, and writes a `teams` blob for each one. Want me to build that next?

### 2. Create Supabase users for each captain

Supabase Dashboard → Authentication → Users → Add user. Email must match `captainEmail` on their team record. Send them the temporary password out of band.

### 3. Generate the schedule (admin)

POST to `/.netlify/functions/admin-generate-schedule`:

```json
{
  "circuit": "I",
  "division": "3.5M",
  "teams": [
    { "id": "t_salty", "name": "Salty Servers" },
    { "id": "t_pier",  "name": "Pier Pressure" },
    ...
  ],
  "courts": ["Court 1", "Court 2", "Court 3"]
}
```

Generates a round-robin across N-1 weeks. For 6 teams: 5 weeks of matches. Weeks 6 and 7 are left empty — fill manually with crossovers or championship bracket.

### 4. Captains sign in at `/captain.html`

Roster → add players → save. Then head to "My matches," pick a match, build the lineup, lock.

---

## Slot enforcement

Every round has 6 games in a fixed order:

| Slot | Type          | Validation                                |
|------|---------------|-------------------------------------------|
| G1   | Women's doubles | Both players must be `gender: 'F'`       |
| G2   | Men's doubles   | Both players must be `gender: 'M'`       |
| G3-G6 | Mixed          | Exactly one `M` + one `F`                |

The picker UI filters non-eligible players out of G1/G2 automatically. Mixed slots show everyone but the server rejects same-gender pairs on save. A player can appear in multiple games within the same round (captains decide if/how to rotate).

Locking validates all 12 slots are complete. Drafts save partial lineups freely.

---

## Security notes

- Captain email allowlist check happens BEFORE Supabase password call in `captain-login.js`, so you never leak which Supabase accounts exist.
- Opponent lineup data is only returned by `captain-lineup.js` when BOTH lineups are locked. The unlocked opponent response is a hard null — no partial leaks.
- Captain cookie is HttpOnly, Secure, SameSite=Strict, 30-day max-age.
- Each captain can only read/write lineups for matches their team is actually in — verified server-side on every call via `findMatch`.

---

## Dependencies

Already installed from earlier drops:
- `@supabase/supabase-js`
- `@netlify/blobs`

No new packages needed.

---

## Env vars

Uses the same Supabase env vars as the admin portal:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

No captain-specific env vars — captains are identified by matching their Supabase email to a `captainEmail` in a team record.

---

## What's next (not yet built)

1. **Team seeder script** — reads confirmed registrations, creates team records + Supabase user accounts for each captain. One command to go from "registration closed" to "captains can sign in."
2. **Captain-facing score entry** — the scoresheet UX. Home captain enters game-by-game results during play; away captain approves. Mirrors the paper flow but digital. This replaces the current admin-only score entry.
3. **Score approval flow** — dual-captain signoff on finished matches before they count toward standings.
4. **Rivalry week (Week 6) + Championship (Week 7)** — these aren't part of the round-robin, so they need manual seeding based on standings. Separate admin tool.

---

## Known constraints

- **Poll-based reveal**: the captain's page polls every 15 seconds while locked-but-waiting. If you want live reveal, need to swap to WebSockets or SSE (not worth it for this use case).
- **No late-swap**: once a lineup is locked, there's no captain-side way to unlock it — player injury mid-warm-up means admin intervention. Acceptable for Circuit I; consider a "request unlock" flow for Circuit II.
- **Schedule assumes 6 teams → 5 weeks of play**: if you end up with 4 or 8 teams in a division, the generator still works but the week count changes. Weeks 6-7 logic is always manual.
