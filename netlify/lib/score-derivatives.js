// netlify/lib/score-derivatives.js
// Scoring rules (per Aloha PB League / Dink Society scoresheet convention):
//
//   • Each round = 6 games. Every game ends 11-anything, win by 1.
//   • Round points (2 points per round, split between home/away):
//       - More games won → 2 points for the winner, 0 for the loser
//       - Tied 3-3       → 1 point each
//   • Match points (4 points per match, between home/away):
//       - Simply the sum of each team's round points
//
// Exports:
//   ROUND_GAME_KEYS         — ['g1','g2','g3','g4','g5','g6']
//   computeRoundDerivatives(roundGames) → {
//     homeGames, awayGames,                   // games won, 0–6
//     homePoints, awayPoints,                 // rally points scored across 6 games
//     roundPointsHome, roundPointsAway,       // round points awarded (0/1/2)
//     winner,                                 // 'home' | 'away' | 'tie'
//     slotResults,                            // { g1: 'home'|'away', ... }
//     slotScores,                             // { g1: { home, away }, ... }
//   }
//   computeMatchPoints(r1, r2) → { scoreA, scoreB }  // 0–4, sums to 4

export const ROUND_GAME_KEYS = ['g1', 'g2', 'g3', 'g4', 'g5', 'g6'];

// roundGames must contain all six slots with valid { home, away } integers.
// Throws if any slot is missing or malformed — by the time this is called,
// captain-score.js has already verified all 12 slots are confirmed, so a
// missing slot here is a programming error, not a user state.
export function computeRoundDerivatives(roundGames) {
  if (!roundGames || typeof roundGames !== 'object') {
    throw new Error('computeRoundDerivatives: roundGames is required');
  }

  let homeGames = 0;
  let awayGames = 0;
  let homePoints = 0;
  let awayPoints = 0;
  const slotResults = {};
  const slotScores = {};

  for (const slot of ROUND_GAME_KEYS) {
    const g = roundGames[slot];
    if (!g || typeof g.home !== 'number' || typeof g.away !== 'number') {
      throw new Error(`computeRoundDerivatives: missing or invalid game at slot ${slot}`);
    }

    slotScores[slot] = { home: g.home, away: g.away };
    homePoints += g.home;
    awayPoints += g.away;

    if (g.home > g.away) {
      homeGames++;
      slotResults[slot] = 'home';
    } else if (g.away > g.home) {
      awayGames++;
      slotResults[slot] = 'away';
    } else {
      // Shouldn't happen with win-by-1 rules, but if it does we don't
      // credit the game to either side
      slotResults[slot] = 'tie';
    }
  }

  let roundPointsHome, roundPointsAway, winner;
  if (homeGames > awayGames) {
    roundPointsHome = 2; roundPointsAway = 0; winner = 'home';
  } else if (awayGames > homeGames) {
    roundPointsHome = 0; roundPointsAway = 2; winner = 'away';
  } else {
    roundPointsHome = 1; roundPointsAway = 1; winner = 'tie';
  }

  return {
    homeGames,
    awayGames,
    homePoints,
    awayPoints,
    roundPointsHome,
    roundPointsAway,
    winner,
    slotResults,
    slotScores,
  };
}

// r1 and r2 are the outputs of computeRoundDerivatives().
// scoreA / scoreB are match points (0–4, always sum to 4).
export function computeMatchPoints(r1, r2) {
  const scoreA = (r1?.roundPointsHome || 0) + (r2?.roundPointsHome || 0);
  const scoreB = (r1?.roundPointsAway || 0) + (r2?.roundPointsAway || 0);
  return { scoreA, scoreB };
}
