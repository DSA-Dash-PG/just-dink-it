// netlify/functions/admin.js
// All admin actions: approve registrations, manage seasons/divisions/teams/players/sponsors

import {
  seasons,
  divisions,
  teams,
  players,
  roster,
  matches,
  registrations,
  sponsors,
  stats,
} from '../lib/db.js';
import { requireAdmin } from '../lib/supabase-auth.js';
import { ok, badRequest, unauthorized, notFound, serverError, cors } from '../lib/response.js';

export const handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') return cors();

  try {
    await requireAdmin(event);
  } catch {
    return unauthorized();
  }

  const params = event.queryStringParameters || {};
  const action = params.action;
  const body = event.body ? JSON.parse(event.body) : {};

  try {
    switch (action) {
      // ─── Seasons ───
      case 'create-season':
        return ok(await seasons.create(body));
      case 'list-seasons':
        return ok(await seasons.list());
      case 'update-season':
        return ok(await seasons.update(body.id, body.patch));

      // ─── Divisions ───
      case 'create-division':
        return ok(await divisions.create(body));
      case 'list-divisions':
        return ok(await divisions.listBySeason(params.seasonId));

      // ─── Teams ───
      case 'list-teams':
        return ok(await teams.list());
      case 'update-team':
        return ok(await teams.update(body.id, body.patch));
      case 'delete-team':
        await teams.delete(body.id);
        return ok({ success: true });

      // ─── Players ───
      case 'list-players':
        return ok(await players.list());
      case 'create-player':
        return ok(await players.create(body));
      case 'update-player':
        return ok(await players.update(body.id, body.patch));

      // ─── Roster (move players between teams) ───
      case 'add-to-roster':
        return ok(await roster.addPlayer(body));
      case 'remove-from-roster':
        await roster.removePlayer(body);
        return ok({ success: true });
      case 'move-player': {
        // Move player from one team to another in the SAME season
        // (for cross-season moves, just add to new season's roster — old stats stay tied via player ID)
        const { playerId, seasonId, fromTeamId, toTeamId, jerseyNumber } = body;
        if (fromTeamId) await roster.removePlayer({ seasonId, teamId: fromTeamId, playerId });
        await roster.addPlayer({ seasonId, teamId: toTeamId, playerId, jerseyNumber });
        await stats.recomputePlayerCareerStats(playerId);
        return ok({ success: true });
      }

      // ─── Registrations ───
      case 'list-registrations':
        return ok(await registrations.list());
      case 'approve-registration': {
        const reg = await registrations.get(body.id);
        if (!reg) return notFound();

        // Create the team
        const team = await teams.create({
          name: reg.teamName,
          seasonId: reg.seasonId,
          divisionId: reg.divisionId,
          captainId: null, // will be set when captain logs in
          neighborhood: '',
          motto: '',
        });

        // Create the captain as a player
        const captain = await players.create({
          name: reg.captainName,
          email: reg.captainEmail,
          phone: reg.captainPhone,
        });

        // Add to roster as captain
        await roster.addPlayer({
          seasonId: reg.seasonId,
          teamId: team.id,
          playerId: captain.id,
          role: 'captain',
        });

        // Update team with captain ID
        await teams.update(team.id, { captainId: captain.id });

        // Mark registration approved
        await registrations.update(body.id, { status: 'approved', teamId: team.id, captainId: captain.id });

        return ok({ team, captain });
      }
      case 'reject-registration':
        return ok(
          await registrations.update(body.id, { status: 'rejected', rejectionReason: body.reason })
        );

      // ─── Sponsors ───
      case 'list-sponsors':
        return ok(await sponsors.list());
      case 'create-sponsor':
        return ok(await sponsors.create(body));
      case 'update-sponsor':
        return ok(await sponsors.update(body.id, body.patch));

      // ─── Matches ───
      case 'create-match':
        return ok(await matches.create(body));
      case 'list-matches':
        return ok(await matches.listBySeason(params.seasonId));
      case 'update-match':
        return ok(await matches.update(body.seasonId, body.id, body.patch));
      case 'finalize-match': {
        const m = await matches.update(body.seasonId, body.id, {
          status: 'final',
          finalScore: body.finalScore,
        });
        // Recompute stats for both teams' rosters
        const seasonRoster = await roster.listBySeason(body.seasonId);
        const affectedPlayers = seasonRoster
          .filter((r) => r.teamId === m.homeTeamId || r.teamId === m.awayTeamId)
          .map((r) => r.playerId);
        await Promise.all(
          [...new Set(affectedPlayers)].map((pid) => stats.recomputePlayerCareerStats(pid))
        );
        return ok(m);
      }

      // ─── Seed (dev/demo only — broken into phases to avoid timeout) ───
      case 'seed-phase-1':
        return ok(await seedPhase1()); // Season + division + 6 teams w/ captains
      case 'seed-phase-2':
        return ok(await seedPhase2(body.seasonId)); // Add players to rosters
      case 'seed-phase-3':
        return ok(await seedPhase3(body.seasonId)); // Matches + finalize + sponsors

      // ─── Reset (NUCLEAR — wipes everything) ───
      case 'reset-all-data':
        return ok(await resetAllData(body.confirmation));

      default:
        return badRequest(`Unknown admin action: ${action}`);
    }
  } catch (err) {
    console.error(err);
    return serverError(err);
  }
};

// ─── Seed helpers ─────────────────────────────────────────────────────────
const SEED_TEAMS = [
  { name: 'Pier Pressure', motto: 'We dink under stress.', neighborhood: 'Hermosa Beach', colors: { primary: '#D85A30', secondary: '#04342C' } },
  { name: 'Salty Servers', motto: 'Soft hands, salty attitude.', neighborhood: 'Manhattan Beach', colors: { primary: '#0F6E56', secondary: '#FAC775' } },
  { name: 'The Kitchen Sink', motto: 'Everything in the kitchen.', neighborhood: 'Redondo Beach', colors: { primary: '#1B4F8E', secondary: '#FAF7F2' } },
  { name: 'Net Profits', motto: 'Always in the green.', neighborhood: 'Palos Verdes', colors: { primary: '#BA7517', secondary: '#04342C' } },
  { name: 'Dinks & Drinks', motto: 'Beer league, A+ effort.', neighborhood: 'Torrance', colors: { primary: '#993C1D', secondary: '#FAC775' } },
  { name: 'Smash Brothers', motto: 'Less dinking, more smashing.', neighborhood: 'Hermosa Beach', colors: { primary: '#2C2C2A', secondary: '#D85A30' } },
];
const FIRST = ['Alex','Sam','Jordan','Taylor','Casey','Morgan','Riley','Drew','Avery','Quinn','Reese','Skyler','Cameron','Hayden','Parker','Sage','Blake','Devin','Emerson','Finley','Gray','Harper','Jamie','Kai','Logan','Marlowe','Nico','Oakley','Phoenix','Rowan'];
const LAST = ['Kim','Patel','Garcia','Nguyen','Lee','Smith','Johnson','Brown','Wong','Singh','Martinez','Anderson','Tanaka','Reyes','Ortega','Chen','Park','Sullivan','Walsh','Cohen','Murphy','Hayes','Reed','Carter','Diaz','Morales'];
const DUPRS = ['3.0','3.1','3.2','3.3','3.4','3.5','3.6','3.7','3.8'];
const COURTS = ['Marine Ave Court 1','Marine Ave Court 2','Live Oak Park Court A','Live Oak Park Court B','PV Estates Court 1','Wilson Park Court 2'];
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = (arr) => arr[rand(0, arr.length - 1)];

// PHASE 1: Season + division + 6 teams with captains only (~6 blob writes per team = ~40 total)
async function seedPhase1() {
  const today = new Date();
  const start = new Date(today.getTime() - 28 * 86400000);
  const end = new Date(today.getTime() + 21 * 86400000);

  const season = await seasons.create({
    name: 'Summer 2026',
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
    status: 'active',
  });

  const division = await divisions.create({
    seasonId: season.id, name: '3.0 Mixed', capacity: 6, price: 450,
  });

  const createdTeams = [];
  for (const spec of SEED_TEAMS) {
    const capName = `${pick(FIRST)} ${pick(LAST)}`;
    const captain = await players.create({
      name: capName,
      email: `${capName.toLowerCase().replace(/[^a-z]/g, '')}.cap@example.com`,
      phone: `(310) 555-${rand(1000, 9999)}`,
      dupr: pick(DUPRS),
      bio: `Captain of ${spec.name}.`,
    });
    const team = await teams.create({
      name: spec.name, seasonId: season.id, divisionId: division.id,
      captainId: captain.id, colors: spec.colors, motto: spec.motto,
      neighborhood: spec.neighborhood,
    });
    await teams.update(team.id, { paymentStatus: 'paid' });
    await roster.addPlayer({ seasonId: season.id, teamId: team.id, playerId: captain.id, role: 'captain' });
    createdTeams.push(team);
  }

  return { seasonId: season.id, divisionId: division.id, teamCount: createdTeams.length, phase: 1 };
}

// PHASE 2: Add 5 extra players per team (~30 players, ~60 blob writes)
async function seedPhase2(seasonId) {
  if (!seasonId) throw new Error('seasonId required');
  const allTeams = await teams.listBySeason(seasonId);
  let playerCount = 0;

  for (const team of allTeams) {
    for (let i = 0; i < 5; i++) {
      const pName = `${pick(FIRST)} ${pick(LAST)}`;
      const player = await players.create({
        name: pName,
        email: `${pName.toLowerCase().replace(/[^a-z]/g, '')}.${rand(1, 999)}@example.com`,
        dupr: pick(DUPRS),
      });
      await roster.addPlayer({
        seasonId, teamId: team.id, playerId: player.id, jerseyNumber: rand(1, 99),
      });
      playerCount++;
    }
  }

  return { playerCount, phase: 2 };
}

// PHASE 3: Schedule matches, finalize past ones, add sponsors (~15 matches + 4 sponsors)
async function seedPhase3(seasonId) {
  if (!seasonId) throw new Error('seasonId required');
  const allTeams = await teams.listBySeason(seasonId);
  const divs = await divisions.listBySeason(seasonId);
  const divisionId = divs[0]?.id;
  const today = new Date();
  const start = new Date(today.getTime() - 28 * 86400000);

  // Round-robin matchups
  const matchups = [];
  for (let i = 0; i < allTeams.length; i++) {
    for (let j = i + 1; j < allTeams.length; j++) {
      matchups.push({ home: allTeams[i], away: allTeams[j] });
    }
  }
  matchups.sort(() => Math.random() - 0.5);

  let pastCount = 0, scheduledCount = 0;
  for (let i = 0; i < matchups.length; i++) {
    const week = Math.floor(i / 3) + 1;
    const matchDate = new Date(start.getTime() + (week - 1) * 7 * 86400000);
    const isPast = matchDate < today;

    const match = await matches.create({
      seasonId, divisionId, week,
      date: matchDate.toISOString().slice(0, 10),
      homeTeamId: matchups[i].home.id, awayTeamId: matchups[i].away.id,
      court: pick(COURTS), isRivalry: false,
    });

    if (isPast) {
      const games = [];
      let hw = 0, aw = 0;
      for (let g = 0; g < 3; g++) {
        if (hw === 2 || aw === 2) break;
        const homeWon = Math.random() > 0.5;
        games.push(homeWon ? { home: 11, away: rand(2, 9) } : { home: rand(2, 9), away: 11 });
        if (homeWon) hw++; else aw++;
      }
      await matches.update(seasonId, match.id, { status: 'final', finalScore: { games } });
      pastCount++;
    } else {
      scheduledCount++;
    }
  }

  // Sponsors
  const mockSponsors = [
    { name: 'South Bay Sports Co.', tier: 'gold', logo: 'https://placehold.co/200x80/0F6E56/FAF7F2?text=SBSC', description: 'Local pickleball gear shop.' },
    { name: 'Pier Burger', tier: 'silver', logo: 'https://placehold.co/200x80/D85A30/FFFFFF?text=Pier+Burger', description: 'Post-match HQ in Hermosa.' },
    { name: 'Manhattan Beach Brewing', tier: 'silver', logo: 'https://placehold.co/200x80/BA7517/FFFFFF?text=MBBC', description: 'Official beer of the league.' },
    { name: 'Coastal Realty', tier: 'bronze', logo: 'https://placehold.co/200x80/1B4F8E/FFFFFF?text=Coastal', description: 'South Bay homes.' },
  ];
  for (const s of mockSponsors) await sponsors.create(s);

  return { matchesFinal: pastCount, matchesScheduled: scheduledCount, sponsors: mockSponsors.length, phase: 3 };
}

// ─── Reset all data (NUCLEAR) ─────────────────────────────────────────────
// Wipes every blob store. Requires explicit confirmation string.

async function resetAllData(confirmation) {
  if (confirmation !== 'DELETE EVERYTHING') {
    throw new Error('Reset requires confirmation string "DELETE EVERYTHING"');
  }

  const { getStore } = await import('@netlify/blobs');
  const storeNames = [
    'seasons',
    'divisions',
    'teams',
    'players',
    'roster',
    'matches',
    'scores',
    'registrations',
    'sponsors',
    'admins',
  ];

  const counts = {};

  const siteID = process.env.NETLIFY_SITE_ID;
  const token = process.env.NETLIFY_BLOBS_TOKEN;

  for (const name of storeNames) {
    const opts = { name, consistency: 'strong' };
    if (siteID && token) {
      opts.siteID = siteID;
      opts.token = token;
    }
    const store = getStore(opts);
    const { blobs } = await store.list();
    counts[name] = blobs.length;
    await Promise.all(blobs.map((b) => store.delete(b.key)));
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return {
    success: true,
    counts,
    summary: `Deleted ${total} records across ${storeNames.length} stores.`,
  };
}
