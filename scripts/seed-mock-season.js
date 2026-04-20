// scripts/seed-mock-season.js
// Populates a full mock season: 1 season, 1 mixed 3.0 division, 6 teams,
// randomized 6-12 player rosters, and 5 weeks of matches (some final, some scheduled)
//
// Usage:
//   node scripts/seed-mock-season.js
//
// Requires:
//   - Project deployed to Netlify (or running via `netlify dev`)
//   - SITE_URL env var (e.g. https://yoursite.netlify.app or http://localhost:8888)
//   - ADMIN_TOKEN env var (your Netlify Identity JWT — get from browser devtools)
//
// To get ADMIN_TOKEN:
//   1. Sign in to /admin.html as an admin
//   2. Open browser console
//   3. Run: copy(netlifyIdentity.currentUser().token.access_token)
//   4. Paste as the env var below

const SITE_URL = process.env.SITE_URL || 'http://localhost:8888';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

if (!ADMIN_TOKEN) {
  console.error('❌ ADMIN_TOKEN env var required. See instructions in this file.');
  process.exit(1);
}

// ─── Mock data pools ──────────────────────────────────────────────────────

const TEAMS = [
  {
    name: 'Pier Pressure',
    motto: 'We dink under stress.',
    neighborhood: 'Hermosa Beach',
    colors: { primary: '#D85A30', secondary: '#04342C' },
  },
  {
    name: 'Salty Servers',
    motto: 'Soft hands, salty attitude.',
    neighborhood: 'Manhattan Beach',
    colors: { primary: '#0F6E56', secondary: '#FAC775' },
  },
  {
    name: 'The Kitchen Sink',
    motto: 'Everything in the kitchen.',
    neighborhood: 'Redondo Beach',
    colors: { primary: '#1B4F8E', secondary: '#FAF7F2' },
  },
  {
    name: 'Net Profits',
    motto: 'Always in the green.',
    neighborhood: 'Palos Verdes',
    colors: { primary: '#BA7517', secondary: '#04342C' },
  },
  {
    name: 'Dinks & Drinks',
    motto: 'Beer league, A+ effort.',
    neighborhood: 'Torrance',
    colors: { primary: '#993C1D', secondary: '#FAC775' },
  },
  {
    name: 'Smash Brothers',
    motto: 'Less dinking, more smashing.',
    neighborhood: 'Hermosa Beach',
    colors: { primary: '#2C2C2A', secondary: '#D85A30' },
  },
];

const FIRST_NAMES = [
  'Alex', 'Sam', 'Jordan', 'Taylor', 'Casey', 'Morgan', 'Riley', 'Drew',
  'Avery', 'Quinn', 'Reese', 'Skyler', 'Cameron', 'Hayden', 'Parker', 'Sage',
  'Blake', 'Devin', 'Emerson', 'Finley', 'Gray', 'Harper', 'Indigo', 'Jamie',
  'Kai', 'Logan', 'Marlowe', 'Nico', 'Oakley', 'Phoenix', 'Rowan', 'Sloane',
  'Tatum', 'Wren', 'Maya', 'Leo', 'Zoe', 'Mateo', 'Nora', 'Eli',
];

const LAST_NAMES = [
  'Kim', 'Patel', 'Garcia', 'Nguyen', 'Lee', 'Smith', 'Johnson', 'Brown',
  'Wong', 'Singh', 'Martinez', 'Anderson', 'Tanaka', 'Reyes', 'Ortega',
  'Chen', 'Park', 'Sullivan', 'Walsh', 'Cohen', 'Murphy', 'Hayes', 'Reed',
  'Carter', 'Diaz', 'Morales', 'Richardson', 'Bennett', 'Ward', 'Cooper',
  'Foster', 'Henderson', 'Coleman', 'Jenkins', 'Powell', 'Long',
];

const DUPRS = ['3.0', '3.1', '3.2', '3.3', '3.4', '3.5', '3.6', '3.7', '3.8'];

const COURTS = [
  'Marine Ave Court 1', 'Marine Ave Court 2', 'Marine Ave Court 3',
  'Live Oak Park Court A', 'Live Oak Park Court B',
  'PV Estates Court 1', 'Wilson Park Court 2', 'Charles Wilson Court 3',
];

// ─── Helpers ──────────────────────────────────────────────────────────────

const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = (arr) => arr[rand(0, arr.length - 1)];
const pickN = (arr, n) => {
  const copy = [...arr];
  const result = [];
  for (let i = 0; i < n && copy.length > 0; i++) {
    result.push(copy.splice(rand(0, copy.length - 1), 1)[0]);
  }
  return result;
};

async function adminCall(action, body) {
  const url = `${SITE_URL}/api/admin?action=${action}`;
  const res = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${ADMIN_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${action} failed: ${res.status} ${text}`);
  }
  return res.json();
}

async function adminGet(action, params = {}) {
  const q = new URLSearchParams({ action, ...params }).toString();
  const res = await fetch(`${SITE_URL}/api/admin?${q}`, {
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
  });
  if (!res.ok) throw new Error(`${action} failed: ${res.status}`);
  return res.json();
}

// ─── Seed sequence ────────────────────────────────────────────────────────

async function seed() {
  console.log(`\n🌱 Seeding mock season at ${SITE_URL}\n`);

  // 1. Create season
  console.log('Creating season "Summer 2026 (Mock)"...');
  const today = new Date();
  const start = new Date(today.getTime() - 28 * 24 * 60 * 60 * 1000); // 4 weeks ago
  const end = new Date(today.getTime() + 21 * 24 * 60 * 60 * 1000); // 3 weeks ahead
  const season = await adminCall('create-season', {
    name: 'Summer 2026 (Mock)',
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
    status: 'active',
  });
  console.log(`  ✓ Season ${season.id}`);

  // 2. Create one mixed 3.0 division
  console.log('Creating "3.0 Mixed" division...');
  const division = await adminCall('create-division', {
    seasonId: season.id,
    name: '3.0 Mixed',
    capacity: 6,
    price: 450,
  });
  console.log(`  ✓ Division ${division.id}`);

  // 3. Create 6 teams + their rosters
  const createdTeams = [];

  for (const teamSpec of TEAMS) {
    console.log(`\nCreating team: ${teamSpec.name}`);

    // Create captain first
    const captainName = `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
    const captainEmail = `${captainName.toLowerCase().replace(/[^a-z]/g, '')}@example.com`;
    const captain = await adminCall('create-player', {
      name: captainName,
      email: captainEmail,
      phone: `(310) 555-${String(rand(1000, 9999))}`,
      dupr: pick(DUPRS),
      bio: `Captain of ${teamSpec.name}. ${pick(['Plays right-handed.', 'Lefty with a wicked backhand.', 'Power player.', 'Dink master.', 'Lobs you to death.'])}`,
    });

    // We need a way to create a team directly. The admin API approves a registration to make a team,
    // so we'll use a slight workaround: create a registration, then approve it.
    // Actually — looking at the admin.js, there isn't a direct "create-team" action. Let's add one.
    // Since we can't easily do that in this seed, we'll go through the registration path.

    const reg = await fetch(`${SITE_URL}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        captainName,
        captainEmail,
        captainPhone: `(310) 555-${String(rand(1000, 9999))}`,
        teamName: teamSpec.name,
        divisionId: division.id,
        seasonId: season.id,
        notes: 'Mock seed registration',
      }),
    }).then(r => r.json());

    const approved = await adminCall('approve-registration', { id: reg.registration.id });
    const team = approved.team;

    // Update team with colors, motto, neighborhood
    await adminCall('update-team', {
      id: team.id,
      patch: {
        colors: teamSpec.colors,
        motto: teamSpec.motto,
        neighborhood: teamSpec.neighborhood,
        paymentStatus: 'paid',
      },
    });

    console.log(`  ✓ Team ${team.id} (captain: ${approved.captain.name})`);

    // Add 5-11 more players to each team (so total roster is 6-12 including captain)
    const additionalCount = rand(5, 11);
    const addedPlayers = [approved.captain];

    for (let i = 0; i < additionalCount; i++) {
      const pName = `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
      const pEmail = `${pName.toLowerCase().replace(/[^a-z]/g, '')}.${rand(1, 999)}@example.com`;
      const player = await adminCall('create-player', {
        name: pName,
        email: pEmail,
        phone: `(310) 555-${String(rand(1000, 9999))}`,
        dupr: pick(DUPRS),
      });

      await adminCall('add-to-roster', {
        seasonId: season.id,
        teamId: team.id,
        playerId: player.id,
        jerseyNumber: rand(1, 99),
      });

      addedPlayers.push(player);
    }
    console.log(`  ✓ ${addedPlayers.length} players on roster`);

    createdTeams.push({ team, players: addedPlayers });
  }

  // 4. Generate round-robin schedule (each team plays every other team once = 15 matches)
  console.log('\nGenerating round-robin schedule (5 weeks, 3 matches/week)...');

  const matchups = [];
  for (let i = 0; i < createdTeams.length; i++) {
    for (let j = i + 1; j < createdTeams.length; j++) {
      matchups.push({ home: createdTeams[i].team, away: createdTeams[j].team });
    }
  }
  // Shuffle
  matchups.sort(() => Math.random() - 0.5);

  // Distribute across 5 weeks (3 per week)
  const seasonStart = new Date(today.getTime() - 28 * 24 * 60 * 60 * 1000);

  for (let i = 0; i < matchups.length; i++) {
    const week = Math.floor(i / 3) + 1;
    const matchDate = new Date(seasonStart.getTime() + (week - 1) * 7 * 24 * 60 * 60 * 1000);
    const dateStr = matchDate.toISOString().slice(0, 10);
    const isPast = matchDate < today;

    const match = await adminCall('create-match', {
      seasonId: season.id,
      divisionId: division.id,
      week,
      date: dateStr,
      homeTeamId: matchups[i].home.id,
      awayTeamId: matchups[i].away.id,
      court: pick(COURTS),
      isRivalry: week === 6,
    });

    // For past matches, finalize with random scores
    if (isPast) {
      // Best of 3, scores typically 11-X
      const games = [];
      let homeWins = 0;
      let awayWins = 0;

      for (let g = 0; g < 3; g++) {
        if (homeWins === 2 || awayWins === 2) break;
        const homeWon = Math.random() > 0.5;
        const winnerScore = 11;
        const loserScore = rand(2, 9);
        const game = homeWon
          ? { home: winnerScore, away: loserScore }
          : { home: loserScore, away: winnerScore };
        games.push(game);
        if (homeWon) homeWins++;
        else awayWins++;
      }

      await adminCall('finalize-match', {
        seasonId: season.id,
        id: match.id,
        finalScore: { games },
      });
      const score = games.map(g => `${g.home}-${g.away}`).join(', ');
      console.log(`  ✓ Wk${week}: ${matchups[i].home.name} vs ${matchups[i].away.name} → ${score} [FINAL]`);
    } else {
      console.log(`  · Wk${week}: ${matchups[i].home.name} vs ${matchups[i].away.name} [scheduled]`);
    }
  }

  // 5. Add a few sponsors
  console.log('\nAdding sponsors...');
  const mockSponsors = [
    { name: 'South Bay Sports Co.', tier: 'gold', logo: 'https://placehold.co/200x80/0F6E56/FAF7F2?text=SBSC', description: 'Local pickleball gear shop.' },
    { name: 'Pier Burger', tier: 'silver', logo: 'https://placehold.co/200x80/D85A30/FFFFFF?text=Pier+Burger', description: 'Post-match HQ in Hermosa.' },
    { name: 'Manhattan Beach Brewing', tier: 'silver', logo: 'https://placehold.co/200x80/BA7517/FFFFFF?text=MBBC', description: 'Official beer of the league.' },
    { name: 'Coastal Realty', tier: 'bronze', logo: 'https://placehold.co/200x80/1B4F8E/FFFFFF?text=Coastal', description: 'South Bay homes.' },
  ];

  for (const s of mockSponsors) {
    await adminCall('create-sponsor', s);
    console.log(`  ✓ ${s.name} (${s.tier})`);
  }

  console.log('\n✅ Mock season seeded successfully!\n');
  console.log(`Visit ${SITE_URL} to see the live data.`);
  console.log(`Stats and standings should populate from the finalized matches.\n`);
}

seed().catch(err => {
  console.error('\n❌ Seed failed:', err.message);
  process.exit(1);
});
