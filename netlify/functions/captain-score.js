// netlify/functions/captain-score.js
// Dual-entry score capture for The Dink Society.
//
// GET   ?match=<id>                     → current scoresheet view
// POST  ?match=<id>                     → set/clear/submit/unsubmit
//                                         body: { action, round?, slot?, home?, away? }
//
// Both captains enter every one of 12 games (2 rounds × 6 slots).
// A slot becomes "confirmed" when both captains' values match.
// The match finalizes only when (a) all 12 slots are confirmed AND
// (b) both captains have tapped "Submit final".
//
// Any score edit auto-clears both submission flags so finalize requires a
// fresh re-confirmation. Finalize writes per-round derivatives back to the
// schedule record so the public leaderboard reads from one store.
//
// Slot keys per round: g1, g2, g3, g4, g5, g6
//   g1 = women's, g2 = men's, g3-g6 = mixed
//
// Body actions:
//   set-game        { round: 'r1'|'r2', slot: 'g1'..'g6', home: int, away: int }
//   clear-game      { round, slot }
//   submit-final    {}        (requires all 12 confirmed)
//   unsubmit-final  {}

import { getStore } from '@netlify/blobs';
import { requireCaptain, unauthResponse } from '../lib/captain-auth.js';
import { computeRoundDerivatives, computeMatchPoints, ROUND_GAME_KEYS } from '../lib/score-derivatives.js';

const ROUND_KEYS = ['r1', 'r2'];
const SLOT_KEYS = ROUND_GAME_KEYS; // ['g1'..'g6']

export default async (req) => {
  const ctx = await requireCaptain(req);
  if (!ctx) return unauthResponse();

  const url = new URL(req.url);
  const matchId = url.searchParams.get('match');
  if (!matchId) return json({ error: 'match id required' }, 400);

  const scheduleStore = getStore('schedule');
  const scoresStore = getStore('scores');

  const found = await findMatch(scheduleStore, matchId, ctx.team);
  if (!found) return json({ error: 'Match not found or not yours' }, 404);
  const { week, weekKey, weekData, match, idx } = found;

  const myTeamId = ctx.team.id;
  const side = match.teamA?.id === myTeamId ? 'home'
             : match.teamB?.id === myTeamId ? 'away'
             : null;
  if (!side) return json({ error: 'Not a captain for this match' }, 403);

  const scoreKey = `score/${matchId}.json`;

  if (req.method === 'GET') {
    const score = (await scoresStore.get(scoreKey, { type: 'json' })) || emptyScoreRecord(matchId);
    return json(buildView(score, side, match, ctx.team, week));
  }

  if (req.method === 'POST') {
    if (match.finalizedAt) return json({ error: 'Match already finalized' }, 409);

    let body;
    try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const action = body?.action;
    if (!action) return json({ error: 'action required' }, 400);

    let score = (await scoresStore.get(scoreKey, { type: 'json' })) || emptyScoreRecord(matchId);

    if (action === 'set-game') {
      const { round, slot, home, away } = body;
      if (!ROUND_KEYS.includes(round)) return json({ error: 'invalid round' }, 400);
      if (!SLOT_KEYS.includes(slot)) return json({ error: 'invalid slot' }, 400);
      if (!validGame(home, away)) {
        return json({ error: 'Invalid score (need integers, winner ≥11, no ties)' }, 400);
      }

      score.games[round][slot][side] = {
        value: { home, away },
        by: ctx.user.email,
        at: new Date().toISOString(),
      };
      score.submitted = { home: null, away: null };
      score.updatedAt = new Date().toISOString();
      await scoresStore.setJSON(scoreKey, score);

      return json(buildView(score, side, match, ctx.team, week));
    }

    if (action === 'clear-game') {
      const { round, slot } = body;
      if (!ROUND_KEYS.includes(round)) return json({ error: 'invalid round' }, 400);
      if (!SLOT_KEYS.includes(slot)) return json({ error: 'invalid slot' }, 400);

      score.games[round][slot][side] = { value: null, by: null, at: null };
      score.submitted = { home: null, away: null };
      score.updatedAt = new Date().toISOString();
      await scoresStore.setJSON(scoreKey, score);

      return json(buildView(score, side, match, ctx.team, week));
    }

    if (action === 'submit-final') {
      const { allConfirmed, confirmedCount, games } = reduceConfirmed(score);
      if (!allConfirmed) {
        return json({ error: `Cannot submit — ${confirmedCount}/12 games confirmed` }, 409);
      }

      score.submitted[side] = new Date().toISOString();
      score.updatedAt = new Date().toISOString();

      if (score.submitted.home && score.submitted.away) {
        // FINALIZE
        const r1 = computeRoundDerivatives(games.r1);
        const r2 = computeRoundDerivatives(games.r2);
        const { scoreA, scoreB } = computeMatchPoints(r1, r2);
        const finalizedAt = new Date().toISOString();

        match.round1 = r1;
        match.round2 = r2;
        match.scoreA = scoreA;
        match.scoreB = scoreB;
        match.finalizedAt = finalizedAt;
        weekData.matches[idx] = match;

        score.finalizedAt = finalizedAt;

        // Schedule first: if scores write fails, we can re-finalize idempotently
        await scheduleStore.setJSON(weekKey, weekData);
        await scoresStore.setJSON(scoreKey, score);

        return json(buildView(score, side, match, ctx.team, week));
      }

      await scoresStore.setJSON(scoreKey, score);
      return json(buildView(score, side, match, ctx.team, week));
    }

    if (action === 'unsubmit-final') {
      score.submitted[side] = null;
      score.updatedAt = new Date().toISOString();
      await scoresStore.setJSON(scoreKey, score);
      return json(buildView(score, side, match, ctx.team, week));
    }

    return json({ error: 'unknown action' }, 400);
  }

  return new Response('Method not allowed', { status: 405 });
};

// ---------- helpers ----------

function emptyScoreRecord(matchId) {
  const games = {};
  for (const r of ROUND_KEYS) {
    games[r] = {};
    for (const s of SLOT_KEYS) {
      games[r][s] = {
        home: { value: null, by: null, at: null },
        away: { value: null, by: null, at: null },
      };
    }
  }
  return {
    matchId,
    games,
    submitted: { home: null, away: null },
    finalizedAt: null,
    updatedAt: new Date().toISOString(),
  };
}

function gameStatus(cell) {
  const h = cell.home.value, a = cell.away.value;
  if (h == null && a == null) return 'empty';
  if (h == null || a == null) return 'partial';
  if (h.home === a.home && h.away === a.away) return 'confirmed';
  return 'mismatch';
}

function reduceConfirmed(score) {
  let allConfirmed = true;
  let confirmedCount = 0;
  const out = { r1: {}, r2: {} };
  for (const r of ROUND_KEYS) {
    for (const s of SLOT_KEYS) {
      const cell = score.games[r][s];
      if (gameStatus(cell) === 'confirmed') {
        out[r][s] = { ...cell.home.value };
        confirmedCount++;
      } else {
        allConfirmed = false;
      }
    }
  }
  return { games: out, allConfirmed, confirmedCount };
}

function viewForUI(score) {
  const view = { r1: {}, r2: {} };
  for (const r of ROUND_KEYS) {
    for (const s of SLOT_KEYS) {
      const cell = score.games[r][s];
      view[r][s] = {
        home: cell.home.value,
        away: cell.away.value,
        status: gameStatus(cell),
      };
    }
  }
  return view;
}

function buildView(score, side, match, myTeam, week) {
  const opponent = match.teamA?.id === myTeam.id ? match.teamB : match.teamA;
  return {
    side,                                              // 'home' or 'away'
    matchId: match.id,
    week,
    myTeam: { id: myTeam.id, name: myTeam.name },
    opponent: { id: opponent?.id, name: opponent?.name },
    court: match.court || null,
    scheduledAt: match.scheduledAt || null,
    finalScore: match.finalizedAt
      ? {
          scoreA: match.scoreA,
          scoreB: match.scoreB,
          round1: match.round1,
          round2: match.round2,
        }
      : null,
    view: viewForUI(score),
    submitted: score.submitted,
    finalizedAt: score.finalizedAt || match.finalizedAt || null,
    updatedAt: score.updatedAt,
  };
}

async function findMatch(scheduleStore, matchId, team) {
  for (let week = 1; week <= 7; week++) {
    const key = `schedule/${team.circuit}/${team.division}/week-${week}.json`;
    const data = await scheduleStore.get(key, { type: 'json' }).catch(() => null);
    if (!data?.matches) continue;
    const idx = data.matches.findIndex((m) => m.id === matchId);
    if (idx >= 0) {
      const m = data.matches[idx];
      if (m.teamA?.id === team.id || m.teamB?.id === team.id) {
        return { week, weekKey: key, weekData: data, match: m, idx };
      }
    }
  }
  return null;
}

function validGame(home, away) {
  if (!Number.isInteger(home) || !Number.isInteger(away)) return false;
  if (home < 0 || away < 0) return false;
  if (home > 30 || away > 30) return false;
  if (home < 11 && away < 11) return false; // someone must reach 11
  if (home === away) return false;          // win by 1 means no ties
  return true;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
  });
}

export const config = { path: '/.netlify/functions/captain-score' };
