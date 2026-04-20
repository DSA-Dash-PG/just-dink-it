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
            name: body.name,
            email: body.email,
            phone: body.phone,
          });
        }
        await roster.addPlayer({
          seasonId: team.seasonId,
          teamId: team.id,
          playerId: player.id,
          jerseyNumber: body.jerseyNumber,
        });
        return ok({ player });
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
        // body = { matchId, teamId, games: [{home, away}, ...], notes }
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
          games: body.games,
          notes: body.notes,
        });

        // If both teams agree, mark match final and recompute stats
        if (scoreRecord.confirmed) {
          await matches.update(team.seasonId, body.matchId, {
            status: 'final',
            finalScore: { games: body.games },
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
