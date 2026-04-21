// netlify/functions/lib/score-derivatives.js
//
// Given a round's raw game scores, derive everything the leaderboard needs:
//   - homeGames / awayGames    (slots won)
//   - homePoints / awayPoints  (sum of game points)
//   - slotResults              (winner per slot)
//   - slotScores               (per-slot point pair)
//
// Slot keys for a round (matches the lineup builder):
//   g1  = Women's doubles
//   g2  = Men's doubles
//   g3..g6 = Mixed doubles
//
// Input shape (ONE round's worth — keys are bare game numbers):
//   {
//     g1: { home: 11, away: 9 },
//     g2: { home: 8,  away: 11 },
//     g3: { home: 11, away: 5 },
//     g4: { home: 11, away: 9 },
//     g5: { home: 7,  away: 11 },
//     g6: { home: 11, away: 4 },
//   }
//
// All 6 slots must be present and confirmed before this is called — the
// finalizer enforces that via the dual-entry submission flags.

export const ROUND_GAME_KEYS = ['g1', 'g2', 'g3', 'g4', 'g5', 'g6'];

// Convenience: full per-match slot keys (round-prefixed). Used elsewhere.
export const FULL_SLOT_KEYS = [
  'r1g1', 'r1g2', 'r1g3', 'r1g4', 'r1g5', 'r1g6',
  'r2g1', 'r2g2', 'r2g3', 'r2g4', 'r2g5', 'r2g6',
];

// Slot-type lookup for analytics (women's / men's / mixed).
export const SLOT_TYPE_BY_GAME = {
  g1: 'womens',
  g2: 'mens',
  g3: 'mixed', g4: 'mixed', g5: 'mixed', g6: 'mixed',
};

/**
 * Compute round-level derivatives from raw per-slot game scores.
 * Returns an object safe to write directly onto match.round1 / match.round2.
 */
export function computeRoundDerivatives(roundGames) {
  if (!roundGames) {
    throw new Error('computeRoundDerivatives: roundGames required');
  }

  let homeGames = 0;
  let awayGames = 0;
  let homePoints = 0;
  let awayPoints = 0;
  const slotResults = {};
  const slotScores = {};

  for (const slot of ROUND_GAME_KEYS) {
    const game = roundGames[slot];
    if (!game || typeof game.home !== 'number' || typeof game.away !== 'number') {
      throw new Error(`computeRoundDerivatives: missing/invalid score for slot "${slot}"`);
    }
    const h = game.home;
    const a = game.away;

    homePoints += h;
    awayPoints += a;
    slotScores[slot] = { home: h, away: a };

    if (h > a) {
      homeGames++;
      slotResults[slot] = 'home';
    } else if (a > h) {
      awayGames++;
      slotResults[slot] = 'away';
    } else {
      // Games are to 11 win-by-1 — ties shouldn't happen. Defensive only.
      slotResults[slot] = 'tie';
    }
  }

  return { homeGames, awayGames, homePoints, awayPoints, slotResults, slotScores };
}

/**
 * Compute match-level points (0–4 per team) from two round derivatives.
 * Round winner = 2 pts, tie = 1-1.
 */
export function computeMatchPoints(r1Derivatives, r2Derivatives) {
  let scoreA = 0;
  let scoreB = 0;

  for (const r of [r1Derivatives, r2Derivatives]) {
    if (r.homeGames > r.awayGames) scoreA += 2;
    else if (r.awayGames > r.homeGames) scoreB += 2;
    else { scoreA += 1; scoreB += 1; }
  }

  return { scoreA, scoreB };
}
