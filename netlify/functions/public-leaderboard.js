// netlify/functions/public-leaderboard.js
//
// Public leaderboard for The Dink Society — no auth required.
//
// Reads ONLY from the schedule store (denormalized derivatives written at
// finalize-time by captain-score.js). Lineups are pulled for the Players
// view to attribute per-slot W/L to individual players.
//
// Query params:
//   circuit   (optional)  Roman numeral, defaults to active circuit
//   division  (optional)  e.g. "3.5M", defaults to first division found
//   view      (optional)  teams | players | society | all (default: teams)
//
// Per-round derivatives written by the finalizer (match.round1 / match.round2):
//   {
//     homeGames, awayGames, homePoints, awayPoints,
//     slotResults: { g1..g6 -> 'home'|'away' },
//     slotScores:  { g1..g6 -> { home, away } }
//   }

import { getStore } from '@netlify/blobs';

const ROMAN_ORDER = ['I','II','III','IV','V','VI','VII','VIII','IX','X'];
const ROUND_KEYS = ['r1', 'r2'];
const SLOT_KEYS = ['g1', 'g2', 'g3', 'g4', 'g5', 'g6'];
const SLOT_TYPE = { g1: 'womens', g2: 'mens', g3: 'mixed', g4: 'mixed', g5: 'mixed', g6: 'mixed' };
const MAX_WEEKS = 7;

const PLACEMENT_POINTS = [100, 75, 50, 30, 15];
const WEEKLY_BONUS_POINTS = 10;
const CLOSE_GAME_MARGIN = 2;

// ---------- tiny helpers ----------

const json = (body, status = 200, extraHeaders = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=60, s-maxage=60',
      ...extraHeaders,
    },
  });
const err = (body, status) => json(body, status, { 'Cache-Control': 'no-store' });

// ---------- discovery ----------

async function listAllCircuits(scheduleStore) {
  const { blobs } = await scheduleStore.list({ prefix: 'schedule/' });
  const set = new Set();
  for (const b of blobs) {
    const parts = b.key.split('/');
    if (parts.length >= 2 && parts[1]) set.add(parts[1]);
  }
  return [...set].sort((a, b) => {
    const ai = ROMAN_ORDER.indexOf(a);
    const bi = ROMAN_ORDER.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

async function listDivisionsForCircuit(scheduleStore, circuit) {
  const { blobs } = await scheduleStore.list({ prefix: `schedule/${circuit}/` });
  const set = new Set();
  for (const b of blobs) {
    const parts = b.key.split('/');
    if (parts.length >= 3 && parts[2]) set.add(parts[2]);
  }
  return [...set].sort();
}

async function loadWeeks(scheduleStore, circuit, division) {
  const weeks = [];
  for (let w = 1; w <= MAX_WEEKS; w++) {
    const key = `schedule/${circuit}/${division}/week-${w}.json`;
    const data = await scheduleStore.get(key, { type: 'json' }).catch(() => null);
    if (data) weeks.push(data);
  }
  return weeks;
}

function pickDefaultCircuit(weeksByCircuit, circuits) {
  const now = Date.now();
  let mostRecentFinalized = null;
  let mostRecentFinalizedAt = 0;
  for (const c of circuits) {
    const weeks = weeksByCircuit[c] || [];
    let hasFinalized = false;
    let hasUnfinalized = false;
    let latest = 0;
    for (const w of weeks) {
      for (const m of w.matches || []) {
        if (m.finalizedAt) {
          hasFinalized = true;
          const t = Date.parse(m.finalizedAt) || 0;
          if (t > latest) latest = t;
        } else {
          hasUnfinalized = true;
        }
      }
    }
    if (hasFinalized && hasUnfinalized) return c; // active
    if (hasFinalized && latest > mostRecentFinalizedAt) {
      mostRecentFinalized = c;
      mostRecentFinalizedAt = latest;
    }
  }
  return mostRecentFinalized || circuits[circuits.length - 1] || null;
}

// ---------- per-match enrichment ----------

function enrichMatch(m, week) {
  if (!m.finalizedAt || !m.round1 || !m.round2) return { ...m, week, _enriched: false };

  const r1 = m.round1, r2 = m.round2;
  const hasDerivatives = !!(r1.slotResults && r2.slotResults);

  const homeGamesTotal = (r1.homeGames || 0) + (r2.homeGames || 0);
  const awayGamesTotal = (r1.awayGames || 0) + (r2.awayGames || 0);
  const homePointsTotal = (r1.homePoints || 0) + (r2.homePoints || 0);
  const awayPointsTotal = (r1.awayPoints || 0) + (r2.awayPoints || 0);

  const sweepRounds =
    (r1.homeGames === 6 || r1.awayGames === 6 ? 1 : 0) +
    (r2.homeGames === 6 || r2.awayGames === 6 ? 1 : 0);
  const sweep = sweepRounds > 0;

  const r1HomeWon = r1.homeGames > r1.awayGames;
  const r1AwayWon = r1.awayGames > r1.homeGames;
  const matchHomeWon = m.scoreA > m.scoreB;
  const matchAwayWon = m.scoreB > m.scoreA;
  const comeback = (r1AwayWon && matchHomeWon) || (r1HomeWon && matchAwayWon);

  let closeGames = 0, closeGamesHomeWon = 0, closeGamesAwayWon = 0;
  if (hasDerivatives) {
    for (const r of [r1, r2]) {
      for (const slot of SLOT_KEYS) {
        const s = r.slotScores?.[slot];
        if (!s) continue;
        const margin = Math.abs(s.home - s.away);
        if (margin <= CLOSE_GAME_MARGIN) {
          closeGames++;
          if (s.home > s.away) closeGamesHomeWon++;
          else if (s.away > s.home) closeGamesAwayWon++;
        }
      }
    }
  }

  const matchMargin = Math.abs(homePointsTotal - awayPointsTotal);

  return {
    ...m,
    week,
    _enriched: true,
    _hasDerivatives: hasDerivatives,
    homeGamesTotal, awayGamesTotal,
    homePointsTotal, awayPointsTotal,
    sweep, sweepRounds,
    comeback,
    closeGames, closeGamesHomeWon, closeGamesAwayWon,
    matchMargin,
  };
}

// ---------- standings ----------

function computeStandings(weeks) {
  const rows = new Map();

  const ensure = (teamRef) => {
    const id = teamRef?.id;
    if (!id) return null;
    if (!rows.has(id)) {
      rows.set(id, {
        teamId: id,
        name: teamRef.name || id,
        played: 0, w: 0, l: 0, t: 0,
        mp: 0,
        pf: 0, pa: 0, diff: 0,
        gamesWon: 0, gamesLost: 0,
        pointsFor: 0, pointsAgainst: 0, pointDiff: 0,
        sweeps: 0, sweptAgainst: 0,
        comebacks: 0,
        closeWins: 0, closeLosses: 0,
        h2h: {},
        results: [],
      });
    }
    return rows.get(id);
  };

  for (const week of weeks) {
    for (const raw of week.matches || []) {
      if (!raw.finalizedAt) continue;
      const m = enrichMatch(raw, week.week);
      const a = ensure(m.teamA);
      const b = ensure(m.teamB);
      if (!a || !b) continue;

      const sa = Number(m.scoreA || 0);
      const sb = Number(m.scoreB || 0);

      a.played++; b.played++;
      a.mp += sa; b.mp += sb;
      a.pf += sa; a.pa += sb;
      b.pf += sb; b.pa += sa;

      if (sa > sb) { a.w++; b.l++; a.results.push('W'); b.results.push('L'); }
      else if (sb > sa) { b.w++; a.l++; a.results.push('L'); b.results.push('W'); }
      else { a.t++; b.t++; a.results.push('T'); b.results.push('T'); }

      a.gamesWon += m.homeGamesTotal; a.gamesLost += m.awayGamesTotal;
      b.gamesWon += m.awayGamesTotal; b.gamesLost += m.homeGamesTotal;

      a.pointsFor += m.homePointsTotal; a.pointsAgainst += m.awayPointsTotal;
      b.pointsFor += m.awayPointsTotal; b.pointsAgainst += m.homePointsTotal;

      for (const r of [m.round1, m.round2]) {
        if (!r) continue;
        if (r.homeGames === 6) { a.sweeps++; b.sweptAgainst++; }
        else if (r.awayGames === 6) { b.sweeps++; a.sweptAgainst++; }
      }

      if (m.comeback) {
        if (sa > sb) a.comebacks++;
        else if (sb > sa) b.comebacks++;
      }

      if (m._hasDerivatives) {
        a.closeWins += m.closeGamesHomeWon;
        a.closeLosses += m.closeGamesAwayWon;
        b.closeWins += m.closeGamesAwayWon;
        b.closeLosses += m.closeGamesHomeWon;
      }

      a.h2h[b.teamId] = a.h2h[b.teamId] || { mp: 0, gamesWon: 0 };
      b.h2h[a.teamId] = b.h2h[a.teamId] || { mp: 0, gamesWon: 0 };
      a.h2h[b.teamId].mp += sa;
      b.h2h[a.teamId].mp += sb;
      a.h2h[b.teamId].gamesWon += m.homeGamesTotal;
      b.h2h[a.teamId].gamesWon += m.awayGamesTotal;
    }
  }

  for (const r of rows.values()) {
    r.diff = r.pf - r.pa;
    r.pointDiff = r.pointsFor - r.pointsAgainst;
    const totalGames = r.gamesWon + r.gamesLost;
    r.avgMargin = totalGames ? +((r.pointsFor - r.pointsAgainst) / totalGames).toFixed(2) : 0;
    r.streak = computeStreak(r.results);
  }

  const list = [...rows.values()];
  list.sort((x, y) => {
    if (y.mp !== x.mp) return y.mp - x.mp;
    const xv = x.h2h[y.teamId];
    const yv = y.h2h[x.teamId];
    if (xv && yv && xv.mp !== yv.mp) return yv.mp - xv.mp;
    if (y.diff !== x.diff) return y.diff - x.diff;
    if (y.pointDiff !== x.pointDiff) return y.pointDiff - x.pointDiff;
    if (y.gamesWon !== x.gamesWon) return y.gamesWon - x.gamesWon;
    return x.name.localeCompare(y.name);
  });

  return list.map((r, i) => ({
    rank: i + 1,
    teamId: r.teamId,
    name: r.name,
    played: r.played,
    w: r.w, l: r.l, t: r.t,
    mp: r.mp,
    pf: r.pf, pa: r.pa, diff: r.diff,
    gamesWon: r.gamesWon, gamesLost: r.gamesLost,
    pointsFor: r.pointsFor, pointsAgainst: r.pointsAgainst, pointDiff: r.pointDiff,
    avgMargin: r.avgMargin,
    sweeps: r.sweeps, sweptAgainst: r.sweptAgainst,
    comebacks: r.comebacks,
    closeWins: r.closeWins, closeLosses: r.closeLosses,
    streak: r.streak,
  }));
}

function computeStreak(results) {
  if (!results.length) return null;
  const last = results[results.length - 1];
  let count = 0;
  for (let i = results.length - 1; i >= 0; i--) {
    if (results[i] === last) count++;
    else break;
  }
  return { type: last, count };
}

// ---------- recent / upcoming ----------

function collectMatches(weeks) {
  const all = [];
  for (const w of weeks) {
    for (const m of w.matches || []) {
      all.push({ ...m, week: w.week });
    }
  }
  return all;
}

function buildRecent(matches, limit = 5) {
  return matches
    .filter((m) => m.finalizedAt)
    .sort((a, b) => Date.parse(b.finalizedAt) - Date.parse(a.finalizedAt))
    .slice(0, limit)
    .map((m) => {
      const e = enrichMatch(m, m.week);
      return {
        id: m.id,
        week: m.week,
        teamA: m.teamA,
        teamB: m.teamB,
        teamAName: m.teamA?.name || m.teamA?.id || '?',
        teamBName: m.teamB?.name || m.teamB?.id || '?',
        scoreA: m.scoreA, scoreB: m.scoreB,
        finalizedAt: m.finalizedAt,
        scheduledAt: m.scheduledAt,
        round1: m.round1 ? {
          homeGames: m.round1.homeGames, awayGames: m.round1.awayGames,
          homePoints: m.round1.homePoints, awayPoints: m.round1.awayPoints,
        } : null,
        round2: m.round2 ? {
          homeGames: m.round2.homeGames, awayGames: m.round2.awayGames,
          homePoints: m.round2.homePoints, awayPoints: m.round2.awayPoints,
        } : null,
        sweep: e.sweep,
        comeback: e.comeback,
        matchMargin: e.matchMargin,
      };
    });
}

function buildUpcoming(matches, limit = 5) {
  const now = Date.now();
  return matches
    .filter((m) => !m.finalizedAt)
    .filter((m) => !m.scheduledAt || Date.parse(m.scheduledAt) >= now)
    .sort((a, b) => {
      const at = Date.parse(a.scheduledAt || '');
      const bt = Date.parse(b.scheduledAt || '');
      if (isNaN(at) && isNaN(bt)) return a.week - b.week;
      if (isNaN(at)) return 1;
      if (isNaN(bt)) return -1;
      return at - bt;
    })
    .slice(0, limit)
    .map((m) => ({
      id: m.id,
      week: m.week,
      teamA: m.teamA, teamB: m.teamB,
      teamAName: m.teamA?.name || m.teamA?.id || '?',
      teamBName: m.teamB?.name || m.teamB?.id || '?',
      court: m.court, venue: m.venue,
      scheduledAt: m.scheduledAt,
    }));
}

// ---------- week highlights ----------

function buildWeekHighlights(weeks) {
  const byWeek = [];
  for (const w of weeks) {
    const finalized = (w.matches || [])
      .filter((m) => m.finalizedAt)
      .map((m) => enrichMatch(m, w.week));
    if (!finalized.length) continue;

    const sweepCandidates = finalized.filter((m) => m.sweep);
    const biggestSweep = sweepCandidates.length
      ? sweepCandidates.reduce((best, m) => {
          if (!best) return m;
          if (m.sweepRounds !== best.sweepRounds) return m.sweepRounds > best.sweepRounds ? m : best;
          return m.matchMargin > best.matchMargin ? m : best;
        }, null)
      : null;

    const comebackCandidates = finalized.filter((m) => m.comeback);
    const biggestComeback = comebackCandidates.length
      ? comebackCandidates.reduce((best, m) =>
          !best || m.matchMargin > best.matchMargin ? m : best, null)
      : null;

    const closeCandidates = finalized.filter((m) => m._hasDerivatives && m.scoreA !== m.scoreB);
    const closest = closeCandidates.length
      ? closeCandidates.reduce((best, m) =>
          !best || m.matchMargin < best.matchMargin ? m : best, null)
      : null;

    const toRow = (m, kind) => m && {
      kind,
      matchId: m.id,
      teamA: m.teamA, teamB: m.teamB,
      teamAName: m.teamA?.name || '?', teamBName: m.teamB?.name || '?',
      scoreA: m.scoreA, scoreB: m.scoreB,
      homePoints: m.homePointsTotal, awayPoints: m.awayPointsTotal,
      margin: m.matchMargin,
      week: m.week,
    };

    byWeek.push({
      week: w.week,
      biggestSweep: toRow(biggestSweep, 'sweep'),
      biggestComeback: toRow(biggestComeback, 'comeback'),
      closest: toRow(closest, 'closest'),
    });
  }
  return byWeek.sort((a, b) => b.week - a.week);
}

function computeWeeklyBonuses(weekHighlights) {
  const totals = new Map();
  const add = (teamId, pts, reason, week) => {
    if (!teamId) return;
    const cur = totals.get(teamId) || { points: 0, awards: [] };
    cur.points += pts;
    cur.awards.push({ week, reason, pts });
    totals.set(teamId, cur);
  };
  for (const wk of weekHighlights) {
    for (const kind of ['biggestSweep', 'biggestComeback', 'closest']) {
      const h = wk[kind];
      if (!h) continue;
      if (kind === 'closest') {
        add(h.teamA?.id, WEEKLY_BONUS_POINTS, 'Closest match', wk.week);
        add(h.teamB?.id, WEEKLY_BONUS_POINTS, 'Closest match', wk.week);
      } else {
        const winnerId = h.scoreA > h.scoreB ? h.teamA?.id : h.teamB?.id;
        const reason = kind === 'biggestSweep' ? 'Biggest sweep' : 'Biggest comeback';
        add(winnerId, WEEKLY_BONUS_POINTS, reason, wk.week);
      }
    }
  }
  return totals;
}

// ---------- players ----------

async function buildPlayers(weeks, lineupsStore, teamsStore) {
  const finalized = [];
  for (const w of weeks) for (const m of w.matches || []) if (m.finalizedAt) finalized.push(m);
  if (!finalized.length) return { players: [], matchMVPs: [] };

  // Load lineups in batches
  const lineupKeys = [];
  for (const m of finalized) {
    lineupKeys.push({ matchId: m.id, teamId: m.teamA?.id });
    lineupKeys.push({ matchId: m.id, teamId: m.teamB?.id });
  }
  const lineups = new Map();
  const batchSize = 8;
  for (let i = 0; i < lineupKeys.length; i += batchSize) {
    const batch = lineupKeys.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map((k) =>
        k.teamId
          ? lineupsStore.get(`lineup/${k.matchId}/${k.teamId}.json`, { type: 'json' }).catch(() => null)
          : Promise.resolve(null)
      )
    );
    batch.forEach((k, idx) => {
      if (results[idx]) lineups.set(`${k.matchId}|${k.teamId}`, results[idx]);
    });
  }

  // Build player info lookup from teams referenced in finalized matches.
  // Lineup records include p1Name/p2Name inline, so we can fall back to those
  // for name display even if a team record isn't loadable.
  const teamIds = new Set();
  for (const m of finalized) {
    if (m.teamA?.id) teamIds.add(m.teamA.id);
    if (m.teamB?.id) teamIds.add(m.teamB.id);
  }
  const teamRecords = new Map();
  await Promise.all(
    [...teamIds].map(async (id) => {
      const t = await teamsStore.get(`team/${id}.json`, { type: 'json' }).catch(() => null);
      if (t) teamRecords.set(id, t);
    })
  );

  // playerId -> { name, teamId, teamName } — seed from rosters, then overlay names from lineup snapshots
  const playerInfo = new Map();
  for (const team of teamRecords.values()) {
    for (const p of team.roster || []) {
      playerInfo.set(p.id, { name: p.name, teamId: team.id, teamName: team.name });
    }
  }
  // Overlay from lineups (handles names for players who may have left the roster)
  for (const lineup of lineups.values()) {
    if (!lineup?.games) continue;
    for (const slotKey of Object.keys(lineup.games)) {
      const g = lineup.games[slotKey];
      if (g?.p1 && g.p1Name && !playerInfo.has(g.p1)) {
        playerInfo.set(g.p1, { name: g.p1Name, teamId: lineup.teamId, teamName: lineup.teamName });
      }
      if (g?.p2 && g.p2Name && !playerInfo.has(g.p2)) {
        playerInfo.set(g.p2, { name: g.p2Name, teamId: lineup.teamId, teamName: lineup.teamName });
      }
    }
  }

  const stats = new Map();
  const ensure = (pid) => {
    if (!stats.has(pid)) {
      const info = playerInfo.get(pid) || { name: pid, teamId: null, teamName: null };
      stats.set(pid, {
        playerId: pid,
        name: info.name,
        teamId: info.teamId,
        teamName: info.teamName,
        gp: 0, w: 0, l: 0,
        pf: 0, pa: 0, plusMinus: 0,
        clutchW: 0, clutchL: 0,
        bySlot: {
          womens: { gp: 0, w: 0, l: 0 },
          mens:   { gp: 0, w: 0, l: 0 },
          mixed:  { gp: 0, w: 0, l: 0 },
        },
        partners: {},
      });
    }
    return stats.get(pid);
  };

  for (const m of finalized) {
    const homeLineup = lineups.get(`${m.id}|${m.teamA?.id}`);
    const awayLineup = lineups.get(`${m.id}|${m.teamB?.id}`);
    if (!homeLineup || !awayLineup) continue;

    for (const roundIdx of [1, 2]) {
      const round = roundIdx === 1 ? m.round1 : m.round2;
      if (!round?.slotResults) continue;

      for (const slot of SLOT_KEYS) {
        const fullKey = `r${roundIdx}${slot}`; // e.g. r1g1
        const homeGame = homeLineup.games?.[fullKey];
        const awayGame = awayLineup.games?.[fullKey];
        if (!homeGame?.p1 || !homeGame?.p2 || !awayGame?.p1 || !awayGame?.p2) continue;

        const result = round.slotResults[slot];
        const score = round.slotScores?.[slot] || { home: 0, away: 0 };
        const margin = Math.abs(score.home - score.away);
        const isClutch = margin <= CLOSE_GAME_MARGIN;
        const slotType = SLOT_TYPE[slot];

        const credit = (pid, won, pf, pa, partnerId) => {
          const s = ensure(pid);
          s.gp++; s.bySlot[slotType].gp++;
          s.pf += pf; s.pa += pa; s.plusMinus += (pf - pa);
          if (won === true) {
            s.w++; s.bySlot[slotType].w++;
            if (isClutch) s.clutchW++;
          } else if (won === false) {
            s.l++; s.bySlot[slotType].l++;
            if (isClutch) s.clutchL++;
          }
          if (partnerId) {
            const p = s.partners[partnerId] || { gp: 0, w: 0, l: 0 };
            p.gp++;
            if (won === true) p.w++; else if (won === false) p.l++;
            s.partners[partnerId] = p;
          }
        };

        const homeWon = result === 'home' ? true : result === 'away' ? false : null;
        const awayWon = result === 'away' ? true : result === 'home' ? false : null;

        credit(homeGame.p1, homeWon, score.home, score.away, homeGame.p2);
        credit(homeGame.p2, homeWon, score.home, score.away, homeGame.p1);
        credit(awayGame.p1, awayWon, score.away, score.home, awayGame.p2);
        credit(awayGame.p2, awayWon, score.away, score.home, awayGame.p1);
      }
    }
  }

  const list = [...stats.values()].map((s) => {
    const partnerEntries = Object.entries(s.partners)
      .filter(([, p]) => p.gp >= 2)
      .map(([pid, p]) => ({
        playerId: pid,
        name: playerInfo.get(pid)?.name || pid,
        gp: p.gp, w: p.w, l: p.l,
        winPct: p.gp ? p.w / p.gp : 0,
      }))
      .sort((a, b) => {
        if (b.winPct !== a.winPct) return b.winPct - a.winPct;
        return b.w - a.w;
      });
    return {
      playerId: s.playerId,
      name: s.name,
      teamId: s.teamId, teamName: s.teamName,
      gp: s.gp, w: s.w, l: s.l,
      winPct: s.gp ? +(s.w / s.gp).toFixed(3) : 0,
      pf: s.pf, pa: s.pa, plusMinus: s.plusMinus,
      clutchW: s.clutchW, clutchL: s.clutchL,
      clutchPct: (s.clutchW + s.clutchL)
        ? +(s.clutchW / (s.clutchW + s.clutchL)).toFixed(3)
        : null,
      bySlot: s.bySlot,
      bestPartner: partnerEntries[0] || null,
    };
  });

  list.sort((a, b) => {
    if (b.winPct !== a.winPct) return b.winPct - a.winPct;
    if (b.plusMinus !== a.plusMinus) return b.plusMinus - a.plusMinus;
    if (b.w !== a.w) return b.w - a.w;
    return a.name.localeCompare(b.name);
  });

  const matchMVPs = computeMatchMVPs(weeks, lineups, playerInfo);
  return { players: list, matchMVPs };
}

function computeMatchMVPs(weeks, lineups, playerInfo) {
  const mvps = [];
  for (const w of weeks) {
    for (const m of w.matches || []) {
      if (!m.finalizedAt) continue;
      const homeLineup = lineups.get(`${m.id}|${m.teamA?.id}`);
      const awayLineup = lineups.get(`${m.id}|${m.teamB?.id}`);
      if (!homeLineup || !awayLineup) continue;

      const perPlayer = new Map();
      const tally = (pid, pf, pa, won) => {
        if (!pid) return;
        const cur = perPlayer.get(pid) || { gp: 0, w: 0, plusMinus: 0 };
        cur.gp++;
        cur.plusMinus += (pf - pa);
        if (won) cur.w++;
        perPlayer.set(pid, cur);
      };

      for (const roundIdx of [1, 2]) {
        const round = roundIdx === 1 ? m.round1 : m.round2;
        if (!round?.slotResults) continue;
        for (const slot of SLOT_KEYS) {
          const fullKey = `r${roundIdx}${slot}`;
          const hg = homeLineup.games?.[fullKey];
          const ag = awayLineup.games?.[fullKey];
          if (!hg?.p1 || !hg?.p2 || !ag?.p1 || !ag?.p2) continue;
          const s = round.slotScores?.[slot] || { home: 0, away: 0 };
          const result = round.slotResults[slot];
          tally(hg.p1, s.home, s.away, result === 'home');
          tally(hg.p2, s.home, s.away, result === 'home');
          tally(ag.p1, s.away, s.home, result === 'away');
          tally(ag.p2, s.away, s.home, result === 'away');
        }
      }

      let bestPid = null, bestScore = -Infinity;
      for (const [pid, s] of perPlayer.entries()) {
        const score = s.w * 3 + s.plusMinus;
        if (score > bestScore) { bestScore = score; bestPid = pid; }
      }
      if (bestPid) {
        const info = playerInfo.get(bestPid) || {};
        const s = perPlayer.get(bestPid);
        mvps.push({
          matchId: m.id,
          week: w.week,
          playerId: bestPid,
          name: info.name || bestPid,
          teamName: info.teamName || '',
          plusMinus: s.plusMinus,
          gamesWon: s.w,
        });
      }
    }
  }
  return mvps;
}

// ---------- society circuit ----------

function isCircuitComplete(weeks) {
  let any = false;
  for (const w of weeks) {
    for (const m of w.matches || []) {
      any = true;
      if (!m.finalizedAt) return false;
    }
  }
  return any;
}

const pointsForRank = (rank) => PLACEMENT_POINTS[rank - 1] || 0;

async function buildSociety(allCircuits, division, scheduleStore) {
  const byCircuit = [];
  const totalsByTeam = new Map();

  for (const c of allCircuits) {
    const weeks = await loadWeeks(scheduleStore, c, division);
    if (!weeks.length) continue;

    const standings = computeStandings(weeks);
    const locked = isCircuitComplete(weeks);
    const weekHighlights = buildWeekHighlights(weeks);
    const bonusMap = computeWeeklyBonuses(weekHighlights);

    const rows = standings.map((s) => {
      const bonus = bonusMap.get(s.teamId) || { points: 0, awards: [] };
      return {
        teamId: s.teamId,
        name: s.name,
        rank: s.rank,
        placementPoints: pointsForRank(s.rank),
        bonusPoints: bonus.points,
        bonusAwards: bonus.awards,
        total: pointsForRank(s.rank) + bonus.points,
        projected: !locked,
      };
    });

    byCircuit.push({ circuit: c, locked, standings: rows });

    for (const r of rows) {
      const cur = totalsByTeam.get(r.teamId) || {
        teamId: r.teamId, name: r.name,
        locked: 0, projected: 0,
        lockedBonus: 0, projectedBonus: 0,
        byCircuit: {},
      };
      cur.byCircuit[c] = {
        rank: r.rank,
        placementPoints: r.placementPoints,
        bonusPoints: r.bonusPoints,
        total: r.total,
        projected: !locked,
      };
      if (locked) {
        cur.locked += r.placementPoints;
        cur.lockedBonus += r.bonusPoints;
      } else {
        cur.projected += r.placementPoints;
        cur.projectedBonus += r.bonusPoints;
      }
      totalsByTeam.set(r.teamId, cur);
    }
  }

  const standings = [...totalsByTeam.values()]
    .map((t) => ({
      ...t,
      total: t.locked + t.projected + t.lockedBonus + t.projectedBonus,
      lockedTotal: t.locked + t.lockedBonus,
      projectedTotal: t.projected + t.projectedBonus,
    }))
    .sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      if (b.lockedTotal !== a.lockedTotal) return b.lockedTotal - a.lockedTotal;
      return a.name.localeCompare(b.name);
    });

  return { circuits: byCircuit, standings };
}

// ---------- handler ----------

export default async (req) => {
  try {
    if (req.method !== 'GET') return err({ error: 'method not allowed' }, 405);

    const url = new URL(req.url);
    const requestedCircuit = url.searchParams.get('circuit');
    const requestedDivision = url.searchParams.get('division');
    const view = url.searchParams.get('view') || 'teams';

    const scheduleStore = getStore('schedule');
    const lineupsStore = getStore('lineups');
    const teamsStore = getStore('teams');

    const circuits = await listAllCircuits(scheduleStore);
    if (!circuits.length) {
      return json({
        meta: { circuit: null, division: null, divisions: [], circuits: [], asOf: new Date().toISOString(), isActive: false },
        standings: [], recent: [], upcoming: [], weekHighlights: [],
      });
    }

    let circuit = requestedCircuit;
    const weeksByCircuit = {};
    if (!circuit) {
      // Probe each circuit for activity, newest first
      for (const c of [...circuits].reverse()) {
        const divs = await listDivisionsForCircuit(scheduleStore, c);
        if (!divs.length) continue;
        const probeDiv = requestedDivision && divs.includes(requestedDivision) ? requestedDivision : divs[0];
        weeksByCircuit[c] = await loadWeeks(scheduleStore, c, probeDiv);
      }
      circuit = pickDefaultCircuit(weeksByCircuit, circuits) || circuits[circuits.length - 1];
    }

    const divisions = await listDivisionsForCircuit(scheduleStore, circuit);
    if (!divisions.length) {
      return json({
        meta: { circuit, division: null, divisions: [], circuits, asOf: new Date().toISOString(), isActive: false },
        standings: [], recent: [], upcoming: [], weekHighlights: [],
      });
    }

    const division = requestedDivision && divisions.includes(requestedDivision) ? requestedDivision : divisions[0];
    const weeks = (weeksByCircuit[circuit] && (!requestedDivision || requestedDivision === division))
      ? weeksByCircuit[circuit]
      : await loadWeeks(scheduleStore, circuit, division);

    const standings = computeStandings(weeks);
    const allMatches = collectMatches(weeks);
    const recent = buildRecent(allMatches);
    const upcoming = buildUpcoming(allMatches);
    const weekHighlights = buildWeekHighlights(weeks);

    const hasUnfinalized = allMatches.some((m) => !m.finalizedAt);
    const hasFinalized = allMatches.some((m) => !!m.finalizedAt);
    const isActive = hasUnfinalized && hasFinalized;

    const payload = {
      meta: { circuit, division, divisions, circuits, asOf: new Date().toISOString(), isActive },
      standings, recent, upcoming, weekHighlights,
    };

    if (view === 'players' || view === 'all') {
      const { players, matchMVPs } = await buildPlayers(weeks, lineupsStore, teamsStore);
      payload.players = players;
      payload.matchMVPs = matchMVPs;
    }
    if (view === 'society' || view === 'all') {
      payload.society = await buildSociety(circuits, division, scheduleStore);
    }

    return json(payload);
  } catch (e) {
    console.error('public-leaderboard error', e);
    return err({ error: 'internal error' }, 500);
  }
};

export const config = { path: '/.netlify/functions/public-leaderboard' };
