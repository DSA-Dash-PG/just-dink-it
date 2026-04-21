// Sanity tests for score-derivatives.js — run with:
//   node netlify/functions/lib/score-derivatives.test.js

import { computeRoundDerivatives, computeMatchPoints } from './score-derivatives.js';

let passed = 0, failed = 0;
const t = (name, fn) => {
  try { fn(); console.log(`✓ ${name}`); passed++; }
  catch (e) { console.error(`✗ ${name}\n  ${e.message}`); failed++; }
};
const eq = (a, b, msg) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${msg || 'mismatch'}\n  expected: ${JSON.stringify(b)}\n  actual:   ${JSON.stringify(a)}`);
  }
};

const sampleRound = {
  g1: { home: 11, away: 9 },   // women's — home wins
  g2: { home: 8,  away: 11 },  // men's   — away wins
  g3: { home: 11, away: 5 },   // mixed   — home wins
  g4: { home: 11, away: 9 },   // mixed   — home wins
  g5: { home: 7,  away: 11 },  // mixed   — away wins
  g6: { home: 11, away: 4 },   // mixed   — home wins
};

t('basic round derivatives', () => {
  const d = computeRoundDerivatives(sampleRound);
  eq(d.homeGames, 4, 'homeGames');
  eq(d.awayGames, 2, 'awayGames');
  eq(d.homePoints, 11+8+11+11+7+11, 'homePoints'); // 59
  eq(d.awayPoints, 9+11+5+9+11+4, 'awayPoints');   // 49
  eq(d.slotResults, {
    g1: 'home', g2: 'away', g3: 'home', g4: 'home', g5: 'away', g6: 'home'
  }, 'slotResults');
  eq(d.slotScores.g1, { home: 11, away: 9 }, 'slotScores.g1');
});

t('match points: split rounds = 2-2', () => {
  const r1 = computeRoundDerivatives(sampleRound);
  const flipped = Object.fromEntries(
    Object.entries(sampleRound).map(([k, v]) => [k, { home: v.away, away: v.home }])
  );
  const r2 = computeRoundDerivatives(flipped);
  const mp = computeMatchPoints(r1, r2);
  eq(mp, { scoreA: 2, scoreB: 2 });
});

t('match points: home sweep both rounds = 4-0', () => {
  const r1 = computeRoundDerivatives(sampleRound);
  const r2 = computeRoundDerivatives(sampleRound);
  const mp = computeMatchPoints(r1, r2);
  eq(mp, { scoreA: 4, scoreB: 0 });
});

t('match points: round tie = 1-1 each', () => {
  const tied = {
    g1: { home: 11, away: 9 },
    g2: { home: 9,  away: 11 },
    g3: { home: 11, away: 9 },
    g4: { home: 9,  away: 11 },
    g5: { home: 11, away: 9 },
    g6: { home: 9,  away: 11 },
  };
  const r = computeRoundDerivatives(tied);
  eq(r.homeGames, 3);
  eq(r.awayGames, 3);
  const mp = computeMatchPoints(r, r);
  eq(mp, { scoreA: 2, scoreB: 2 });
});

t('throws on missing slot', () => {
  let threw = false;
  try {
    computeRoundDerivatives({ g1: { home: 11, away: 9 } });
  } catch { threw = true; }
  if (!threw) throw new Error('should have thrown');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
