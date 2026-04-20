// netlify/lib/db.js
// Data access layer for Just Dink It
// Uses Netlify Blobs as a key-value store with hierarchical keys
//
// Key conventions:
//   seasons/{seasonId}                      → Season metadata
//   divisions/{seasonId}/{divisionId}       → Division within a season
//   teams/{teamId}                          → Team (persists across seasons via seasonId field)
//   players/{playerId}                      → Player (PERSISTS FOREVER - career stats follow them)
//   roster/{seasonId}/{teamId}/{playerId}   → Maps player to team for a specific season
//   matches/{seasonId}/{matchId}            → Match record
//   scores/{matchId}                        → Score entries (with both-captain-must-match logic)
//   playerStats/{playerId}/{seasonId}       → Per-season stats (computed from matches)
//   sponsors/{sponsorId}                    → Sponsor records
//   registrations/{regId}                   → Pending captain registrations
//   admins/{userId}                         → Admin user records

import { getStore } from '@netlify/blobs';

// Get a typed store. Each "store" is a namespace in Netlify Blobs.
//
// We pass siteID and token explicitly because Netlify Blobs v8 requires them
// when running in the classic Functions v1 handler format. These values come
// from env vars NETLIFY_SITE_ID and NETLIFY_BLOBS_TOKEN which you set in the
// Netlify dashboard (see README for setup).
const store = (name) => {
  const opts = { name, consistency: 'strong' };
  const siteID = process.env.NETLIFY_SITE_ID;
  const token = process.env.NETLIFY_BLOBS_TOKEN;
  if (siteID && token) {
    opts.siteID = siteID;
    opts.token = token;
  }
  return getStore(opts);
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const slugify = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const newId = (prefix = '') =>
  `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const now = () => new Date().toISOString();

// ─────────────────────────────────────────────────────────────────────────────
// SEASONS
// ─────────────────────────────────────────────────────────────────────────────

export const seasons = {
  async create({ name, startDate, endDate, status = 'upcoming' }) {
    const id = newId('s_');
    const data = {
      id,
      name,
      slug: slugify(name),
      startDate,
      endDate,
      status, // 'upcoming' | 'registration_open' | 'active' | 'completed'
      createdAt: now(),
    };
    await store('seasons').setJSON(id, data);
    return data;
  },

  async get(id) {
    return store('seasons').get(id, { type: 'json' });
  },

  async list() {
    const { blobs } = await store('seasons').list();
    const items = await Promise.all(
      blobs.map((b) => store('seasons').get(b.key, { type: 'json' }))
    );
    return items
      .filter(Boolean)
      .sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));
  },

  async update(id, patch) {
    const existing = await this.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...patch, updatedAt: now() };
    await store('seasons').setJSON(id, updated);
    return updated;
  },

  async getCurrent() {
    const all = await this.list();
    return (
      all.find((s) => s.status === 'active') ||
      all.find((s) => s.status === 'registration_open') ||
      all[0]
    );
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// DIVISIONS
// ─────────────────────────────────────────────────────────────────────────────

export const divisions = {
  async create({ seasonId, name, capacity = 6, price = 450 }) {
    const id = newId('d_');
    const data = {
      id,
      seasonId,
      name, // e.g. "3.0", "3.5+"
      slug: slugify(name),
      capacity,
      price,
      createdAt: now(),
    };
    await store('divisions').setJSON(`${seasonId}/${id}`, data);
    return data;
  },

  async get(seasonId, id) {
    return store('divisions').get(`${seasonId}/${id}`, { type: 'json' });
  },

  async listBySeason(seasonId) {
    const { blobs } = await store('divisions').list({ prefix: `${seasonId}/` });
    const items = await Promise.all(
      blobs.map((b) => store('divisions').get(b.key, { type: 'json' }))
    );
    return items.filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// TEAMS
// ─────────────────────────────────────────────────────────────────────────────

export const teams = {
  async create({ name, seasonId, divisionId, captainId, colors, logo, motto, neighborhood }) {
    const id = newId('t_');
    const data = {
      id,
      name,
      slug: slugify(name),
      seasonId,
      divisionId,
      captainId,
      colors: colors || { primary: '#D85A30', secondary: '#2C2C2A' },
      logo: logo || null,
      motto: motto || '',
      neighborhood: neighborhood || '',
      paymentStatus: 'pending', // 'pending' | 'paid' | 'refunded'
      stripeSessionId: null,
      createdAt: now(),
    };
    await store('teams').setJSON(id, data);
    return data;
  },

  async get(id) {
    return store('teams').get(id, { type: 'json' });
  },

  async getBySlug(slug) {
    const all = await this.list();
    return all.find((t) => t.slug === slug);
  },

  async list() {
    const { blobs } = await store('teams').list();
    const items = await Promise.all(
      blobs.map((b) => store('teams').get(b.key, { type: 'json' }))
    );
    return items.filter(Boolean);
  },

  async listBySeason(seasonId) {
    const all = await this.list();
    return all.filter((t) => t.seasonId === seasonId);
  },

  async listBySeasonAndDivision(seasonId, divisionId) {
    const all = await this.list();
    return all.filter((t) => t.seasonId === seasonId && t.divisionId === divisionId);
  },

  async update(id, patch) {
    const existing = await this.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...patch, updatedAt: now() };
    if (patch.name) updated.slug = slugify(patch.name);
    await store('teams').setJSON(id, updated);
    return updated;
  },

  async delete(id) {
    await store('teams').delete(id);
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// PLAYERS  (the most important entity for "community building")
// Players persist FOREVER. Their team affiliation is just a roster entry per season.
// ─────────────────────────────────────────────────────────────────────────────

export const players = {
  async create({ name, firstName, lastName, nickname, email, headshot, bio, dupr, phone, sex, city }) {
    const id = newId('p_');
    // Build display name from first/last if provided, else fall back to legacy 'name'
    const displayName = (firstName && lastName) ? `${firstName} ${lastName}` : name || 'Unknown';
    const data = {
      id,
      name: displayName,
      firstName: firstName || '',
      lastName: lastName || '',
      nickname: nickname || '',
      slug: slugify(displayName) + '-' + id.slice(-4),
      email: email?.toLowerCase() || null,
      headshot: headshot || null,
      bio: bio || '',
      dupr: dupr || null,
      phone: phone || null,
      sex: sex || null,       // 'Male' | 'Female'
      city: city || '',
      joinedDate: now(),
      // Career-spanning denormalized stats for fast profile loads
      careerStats: {
        seasons: 0,
        matchesPlayed: 0,
        wins: 0,
        losses: 0,
        pointsFor: 0,
        pointsAgainst: 0,
        teams: [], // array of {teamId, teamName, seasonId, seasonName}
      },
    };
    await store('players').setJSON(id, data);
    return data;
  },

  async get(id) {
    return store('players').get(id, { type: 'json' });
  },

  async getBySlug(slug) {
    const all = await this.list();
    return all.find((p) => p.slug === slug);
  },

  async getByEmail(email) {
    if (!email) return null;
    const all = await this.list();
    return all.find((p) => p.email === email.toLowerCase());
  },

  async list() {
    const { blobs } = await store('players').list();
    const items = await Promise.all(
      blobs.map((b) => store('players').get(b.key, { type: 'json' }))
    );
    return items.filter(Boolean);
  },

  async update(id, patch) {
    const existing = await this.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...patch, updatedAt: now() };
    await store('players').setJSON(id, updated);
    return updated;
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// ROSTER  (the bridge: maps a player to a team for a given season)
// This is what enables "move a player to a new team next season, stats follow"
// ─────────────────────────────────────────────────────────────────────────────

export const roster = {
  async addPlayer({ seasonId, teamId, playerId, role = 'player' }) {
    const data = {
      seasonId,
      teamId,
      playerId,
      role, // 'captain' | 'player'
      addedAt: now(),
    };
    await store('roster').setJSON(`${seasonId}/${teamId}/${playerId}`, data);
    return data;
  },

  async removePlayer({ seasonId, teamId, playerId }) {
    await store('roster').delete(`${seasonId}/${teamId}/${playerId}`);
  },

  async listByTeam(seasonId, teamId) {
    const { blobs } = await store('roster').list({ prefix: `${seasonId}/${teamId}/` });
    const entries = await Promise.all(
      blobs.map((b) => store('roster').get(b.key, { type: 'json' }))
    );
    return entries.filter(Boolean);
  },

  async listByPlayer(playerId) {
    // Scan all roster entries — for a real production scale we'd maintain a reverse index
    const { blobs } = await store('roster').list();
    const all = await Promise.all(
      blobs.map((b) => store('roster').get(b.key, { type: 'json' }))
    );
    return all.filter((r) => r && r.playerId === playerId);
  },

  async listBySeason(seasonId) {
    const { blobs } = await store('roster').list({ prefix: `${seasonId}/` });
    const entries = await Promise.all(
      blobs.map((b) => store('roster').get(b.key, { type: 'json' }))
    );
    return entries.filter(Boolean);
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// MATCHES & SCORES
// ─────────────────────────────────────────────────────────────────────────────

export const matches = {
  async create({ seasonId, divisionId, week, date, homeTeamId, awayTeamId, court, isRivalry = false }) {
    const id = newId('m_');
    const data = {
      id,
      seasonId,
      divisionId,
      week,
      date,
      homeTeamId,
      awayTeamId,
      court: court || '',
      isRivalry,
      status: 'scheduled', // 'scheduled' | 'awaiting_confirmation' | 'final' | 'disputed'
      finalScore: null,
      createdAt: now(),
    };
    await store('matches').setJSON(`${seasonId}/${id}`, data);
    return data;
  },

  async get(seasonId, id) {
    return store('matches').get(`${seasonId}/${id}`, { type: 'json' });
  },

  async listBySeason(seasonId) {
    const { blobs } = await store('matches').list({ prefix: `${seasonId}/` });
    const items = await Promise.all(
      blobs.map((b) => store('matches').get(b.key, { type: 'json' }))
    );
    return items
      .filter(Boolean)
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  },

  async update(seasonId, id, patch) {
    const existing = await this.get(seasonId, id);
    if (!existing) return null;
    const updated = { ...existing, ...patch, updatedAt: now() };
    await store('matches').setJSON(`${seasonId}/${id}`, updated);
    return updated;
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// SCORES (both-captain-must-match flow)
// ─────────────────────────────────────────────────────────────────────────────

export const scores = {
  async submit({ matchId, submittedByTeamId, games, notes }) {
    // games = [{home: 11, away: 9}, {home: 11, away: 7}]  (best of 3 typically)
    const existing = (await store('scores').get(matchId, { type: 'json' })) || {
      matchId,
      submissions: {},
    };

    existing.submissions[submittedByTeamId] = {
      games,
      notes: notes || '',
      submittedAt: now(),
    };

    // Check if both teams submitted matching scores
    const subs = Object.values(existing.submissions);
    if (subs.length === 2) {
      const [a, b] = subs;
      const matches =
        JSON.stringify(a.games) === JSON.stringify(b.games);
      existing.confirmed = matches;
      existing.disputed = !matches;
      if (matches) existing.confirmedAt = now();
    }

    await store('scores').setJSON(matchId, existing);
    return existing;
  },

  async get(matchId) {
    return store('scores').get(matchId, { type: 'json' });
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// REGISTRATIONS (pending captain signups awaiting admin approval)
// ─────────────────────────────────────────────────────────────────────────────

export const registrations = {
  async create({ captainName, captainEmail, captainPhone, teamName, divisionId, seasonId, notes }) {
    const id = newId('reg_');
    const data = {
      id,
      captainName,
      captainEmail: captainEmail.toLowerCase(),
      captainPhone,
      teamName,
      seasonId,
      divisionId,
      notes: notes || '',
      status: 'pending', // 'pending' | 'approved' | 'rejected' | 'paid'
      createdAt: now(),
    };
    await store('registrations').setJSON(id, data);
    return data;
  },

  async get(id) {
    return store('registrations').get(id, { type: 'json' });
  },

  async list() {
    const { blobs } = await store('registrations').list();
    const items = await Promise.all(
      blobs.map((b) => store('registrations').get(b.key, { type: 'json' }))
    );
    return items
      .filter(Boolean)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async update(id, patch) {
    const existing = await this.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...patch, updatedAt: now() };
    await store('registrations').setJSON(id, updated);
    return updated;
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// SPONSORS
// ─────────────────────────────────────────────────────────────────────────────

export const sponsors = {
  async create({ name, logo, link, tier = 'bronze', description }) {
    const id = newId('sp_');
    const data = {
      id,
      name,
      slug: slugify(name),
      logo,
      link: link || null,
      tier, // 'platinum' | 'gold' | 'silver' | 'bronze'
      description: description || '',
      active: true,
      createdAt: now(),
    };
    await store('sponsors').setJSON(id, data);
    return data;
  },

  async list() {
    const { blobs } = await store('sponsors').list();
    const items = await Promise.all(
      blobs.map((b) => store('sponsors').get(b.key, { type: 'json' }))
    );
    return items.filter(Boolean).filter((s) => s.active);
  },

  async update(id, patch) {
    const existing = await store('sponsors').get(id, { type: 'json' });
    if (!existing) return null;
    const updated = { ...existing, ...patch };
    await store('sponsors').setJSON(id, updated);
    return updated;
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// STATS COMPUTATION  (called when a match becomes final)
// ─────────────────────────────────────────────────────────────────────────────

export const stats = {
  // Recompute team standings for a season from scratch (idempotent, safe to call anytime)
  async computeStandings(seasonId) {
    const allMatches = await matches.listBySeason(seasonId);
    const finalMatches = allMatches.filter((m) => m.status === 'final' && m.finalScore);

    const standings = {}; // teamId → record

    const init = (teamId) => {
      if (!standings[teamId]) {
        standings[teamId] = {
          teamId,
          wins: 0,
          losses: 0,
          pointsFor: 0,
          pointsAgainst: 0,
          gamesWon: 0,
          gamesLost: 0,
          streak: { type: null, count: 0 },
          recent: [], // last 5 results, newest first
        };
      }
    };

    // Sort matches chronologically for streak calculation
    const sorted = [...finalMatches].sort((a, b) =>
      (a.date || '').localeCompare(b.date || '')
    );

    for (const match of sorted) {
      const { homeTeamId, awayTeamId, finalScore } = match;
      init(homeTeamId);
      init(awayTeamId);

      let homeGameWins = 0;
      let awayGameWins = 0;
      let homePoints = 0;
      let awayPoints = 0;

      for (const game of finalScore.games) {
        homePoints += game.home;
        awayPoints += game.away;
        if (game.home > game.away) homeGameWins++;
        else awayGameWins++;
      }

      const homeWon = homeGameWins > awayGameWins;

      standings[homeTeamId].pointsFor += homePoints;
      standings[homeTeamId].pointsAgainst += awayPoints;
      standings[homeTeamId].gamesWon += homeGameWins;
      standings[homeTeamId].gamesLost += awayGameWins;
      standings[awayTeamId].pointsFor += awayPoints;
      standings[awayTeamId].pointsAgainst += homePoints;
      standings[awayTeamId].gamesWon += awayGameWins;
      standings[awayTeamId].gamesLost += homeGameWins;

      if (homeWon) {
        standings[homeTeamId].wins++;
        standings[awayTeamId].losses++;
        standings[homeTeamId].recent.unshift('W');
        standings[awayTeamId].recent.unshift('L');
      } else {
        standings[awayTeamId].wins++;
        standings[homeTeamId].losses++;
        standings[awayTeamId].recent.unshift('W');
        standings[homeTeamId].recent.unshift('L');
      }
    }

    // Compute streaks and trim recent
    for (const teamId in standings) {
      const s = standings[teamId];
      s.recent = s.recent.slice(0, 5);
      // Compute streak from recent results
      if (s.recent.length > 0) {
        const type = s.recent[0];
        let count = 1;
        for (let i = 1; i < s.recent.length; i++) {
          if (s.recent[i] === type) count++;
          else break;
        }
        s.streak = { type, count };
      }
      const total = s.wins + s.losses;
      s.winPct = total > 0 ? s.wins / total : 0;
      s.pointDiff = s.pointsFor - s.pointsAgainst;
    }

    return Object.values(standings).sort((a, b) => {
      if (b.winPct !== a.winPct) return b.winPct - a.winPct;
      return b.pointDiff - a.pointDiff;
    });
  },

  // Recompute career stats for a player by walking all their roster entries + match results
  async recomputePlayerCareerStats(playerId) {
    const player = await players.get(playerId);
    if (!player) return null;

    const rosterEntries = await roster.listByPlayer(playerId);
    const seasonIds = [...new Set(rosterEntries.map((r) => r.seasonId))];

    const career = {
      seasons: seasonIds.length,
      matchesPlayed: 0,
      wins: 0,
      losses: 0,
      pointsFor: 0,
      pointsAgainst: 0,
      teams: [],
    };

    for (const entry of rosterEntries) {
      const team = await teams.get(entry.teamId);
      const season = await seasons.get(entry.seasonId);
      if (team && season) {
        career.teams.push({
          teamId: team.id,
          teamName: team.name,
          teamSlug: team.slug,
          seasonId: season.id,
          seasonName: season.name,
        });
      }

      // Walk all matches this team played in this season
      const seasonMatches = await matches.listBySeason(entry.seasonId);
      const teamMatches = seasonMatches.filter(
        (m) =>
          m.status === 'final' &&
          m.finalScore &&
          (m.homeTeamId === entry.teamId || m.awayTeamId === entry.teamId)
      );

      for (const match of teamMatches) {
        career.matchesPlayed++;
        const isHome = match.homeTeamId === entry.teamId;
        let myGameWins = 0;
        let oppGameWins = 0;
        let myPoints = 0;
        let oppPoints = 0;
        for (const g of match.finalScore.games) {
          if (isHome) {
            myPoints += g.home;
            oppPoints += g.away;
            if (g.home > g.away) myGameWins++;
            else oppGameWins++;
          } else {
            myPoints += g.away;
            oppPoints += g.home;
            if (g.away > g.home) myGameWins++;
            else oppGameWins++;
          }
        }
        career.pointsFor += myPoints;
        career.pointsAgainst += oppPoints;
        if (myGameWins > oppGameWins) career.wins++;
        else career.losses++;
      }
    }

    await players.update(playerId, { careerStats: career });
    return career;
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// AUTH NOTE: Authentication has moved to ./supabase-auth.js
// (uses Supabase Auth instead of Netlify Identity)
// ─────────────────────────────────────────────────────────────────────────────

export { slugify, newId };
