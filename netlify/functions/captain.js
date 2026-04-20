// netlify/functions/captain.js
// Captain actions: edit own team, manage roster, submit scores

import { teams, players, roster, matches, scores, stats } from '../lib/db.js';
import { requireUser, isAdmin } from '../lib/supabase-auth.js';
import { ok, badRequest, unauthorized, notFound, serverError, cors } from '../lib/response.js';

const verifyCaptainOwnsTeam = async (user, teamId) => {
  const team = await teams.get(teamId);
  if (!team) throw new Error('Team not found');
  // If admin, allow
  if (isAdmin(user)) return team;
  // Otherwise check captain by email match
  const captain = team.captainId ? await players.get(team.captainId) : null;
  if (!captain || captain.email !== user.email?.toLowerCase()) {
    throw new Error('UNAUTHORIZED');
  }
  return team;
};

export const handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') return cors();

  let user;
  try {
    user = await requireUser(event);
  } catch {
    return unauthorized();
  }

  const params = event.queryStringParameters || {};
  const action = params.action;
  const body = event.body ? JSON.parse(event.body) : {};

  try {
    switch (action) {
      case 'my-team': {
        // Find team where captain.email = user.email
        const allTeams = await teams.list();
        const captainPlayer = await players.getByEmail(user.email);
        if (!captainPlayer) return ok({ team: null });
        const myTeam = allTeams.find((t) => t.captainId === captainPlayer.id);
        if (!myTeam) return ok({ team: null });

        const rosterEntries = await roster.listByTeam(myTeam.seasonId, myTeam.id);
        const rosterPlayers = await Promise.all(
          rosterEntries.map(async (r) => ({ ...r, player: await players.get(r.playerId) }))
        );
        return ok({ team: myTeam, roster: rosterPlayers });
      }

      case 'update-team': {
        const team = await verifyCaptainOwnsTeam(user, body.id);
        const allowedFields = ['name', 'colors', 'logo', 'motto', 'neighborhood'];
        const patch = {};
        for (const f of allowedFields) if (body.patch[f] !== undefined) patch[f] = body.patch[f];
        return ok(await teams.update(team.id, patch));
      }

      case 'add-player': {
        const team = await verifyCaptainOwnsTeam(user, body.teamId);
        // Find or create player
        let player = body.email ? await players.getByEmail(body.email) : null;
        if (!player) {
          player = await players.create({
            firstName: body.firstName,
            lastName: body.lastName,
            name: body.name, // legacy fallback
            nickname: body.nickname,
            email: body.email,
            phone: body.phone,
            sex: body.sex,
            city: body.city,
          });
        } else {
          // Update existing player with any new info
          const patch = {};
          if (body.firstName) patch.firstName = body.firstName;
          if (body.lastName) patch.lastName = body.lastName;
          if (body.nickname) patch.nickname = body.nickname;
          if (body.phone) patch.phone = body.phone;
          if (body.sex) patch.sex = body.sex;
          if (body.city) patch.city = body.city;
          if (body.firstName && body.lastName) patch.name = `${body.firstName} ${body.lastName}`;
          if (Object.keys(patch).length) await players.update(player.id, patch);
        }
        await roster.addPlayer({
          seasonId: team.seasonId,
          teamId: team.id,
          playerId: player.id,
        });
        return ok({ player });
      }

      case 'add-players-bulk': {
        const team = await verifyCaptainOwnsTeam(user, body.teamId);
        const results = [];
        for (const p of (body.players || [])) {
          if (!p.firstName || !p.lastName) continue;
          let player = p.email ? await players.getByEmail(p.email) : null;
          if (!player) {
            player = await players.create({
              firstName: p.firstName,
              lastName: p.lastName,
              nickname: p.nickname,
              email: p.email,
              phone: p.phone,
              sex: p.sex,
              city: p.city,
            });
          } else {
            const patch = {};
            if (p.firstName) patch.firstName = p.firstName;
            if (p.lastName) patch.lastName = p.lastName;
            if (p.nickname) patch.nickname = p.nickname;
            if (p.phone) patch.phone = p.phone;
            if (p.sex) patch.sex = p.sex;
            if (p.city) patch.city = p.city;
            if (p.firstName && p.lastName) patch.name = `${p.firstName} ${p.lastName}`;
            if (Object.keys(patch).length) await players.update(player.id, patch);
          }
          await roster.addPlayer({
            seasonId: team.seasonId,
            teamId: team.id,
            playerId: player.id,
          });
          results.push(player);
        }
        return ok({ players: results, count: results.length });
      }

      case 'remove-player': {
        const team = await verifyCaptainOwnsTeam(user, body.teamId);
        await roster.removePlayer({
          seasonId: team.seasonId,
          teamId: team.id,
          playerId: body.playerId,
        });
        return ok({ success: true });
      }

      case 'submit-score': {
        // body = { matchId, teamId, rounds: [ { games: [{type, home:{p1,p2,score}, away:{p1,p2,score}}, ...] }, ... ], notes }
        const team = await verifyCaptainOwnsTeam(user, body.teamId);

        // Verify this team is actually in this match
        const match = await matches.get(team.seasonId, body.matchId);
        if (!match) return notFound();
        if (match.homeTeamId !== team.id && match.awayTeamId !== team.id) {
          return unauthorized();
        }

        const scoreRecord = await scores.submit({
          matchId: body.matchId,
          submittedByTeamId: team.id,
          rounds: body.rounds,
          notes: body.notes,
        });

        // If both teams agree, mark match final and recompute stats
        if (scoreRecord.confirmed) {
          await matches.update(team.seasonId, body.matchId, {
            status: 'final',
            finalScore: { rounds: body.rounds },
          });

          const seasonRoster = await roster.listBySeason(team.seasonId);
          const affectedPlayers = seasonRoster
            .filter((r) => r.teamId === match.homeTeamId || r.teamId === match.awayTeamId)
            .map((r) => r.playerId);
          await Promise.all(
            [...new Set(affectedPlayers)].map((pid) => stats.recomputePlayerCareerStats(pid))
          );
        } else if (scoreRecord.disputed) {
          await matches.update(team.seasonId, body.matchId, { status: 'disputed' });
        } else {
          await matches.update(team.seasonId, body.matchId, { status: 'awaiting_confirmation' });
        }

        return ok(scoreRecord);
      }

      default:
        return badRequest(`Unknown captain action: ${action}`);
    }
  } catch (err) {
    if (err.message === 'UNAUTHORIZED') return unauthorized();
    console.error(err);
    return serverError(err);
  }
};
