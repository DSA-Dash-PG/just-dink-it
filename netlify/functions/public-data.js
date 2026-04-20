// netlify/functions/public-data.js
// Public read-only endpoint for homepage / teams / schedule

import { seasons, divisions, teams, matches, stats, players, roster, sponsors } from '../lib/db.js';
import { ok, badRequest, serverError, cors } from '../lib/response.js';

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return cors();
  try {
    const params = event.queryStringParameters || {};
    const action = params.action;
    switch (action) {
      case 'season-overview': {
        const seasonId = params.seasonId;
        const season = seasonId
          ? await seasons.get(seasonId)
          : await seasons.getCurrent();
        if (!season) return ok({ season: null });
        const [divs, allTeams, allMatches, standings] = await Promise.all([
          divisions.listBySeason(season.id),
          teams.listBySeason(season.id),
          matches.listBySeason(season.id),
          stats.computeStandings(season.id),
        ]);
        return ok({
          season,
          divisions: divs,
          teams: allTeams,
          matches: allMatches,
          standings,
        });
      }
      case 'team': {
        const slug = params.slug;
        if (!slug) return badRequest('slug required');
        const team = await teams.getBySlug(slug);
        if (!team) return ok({ team: null });
        const [season, division, rosterEntries, allMatches] = await Promise.all([
          seasons.get(team.seasonId),
          divisions.get(team.seasonId, team.divisionId),
          roster.listByTeam(team.seasonId, team.id),
          matches.listBySeason(team.seasonId),
        ]);
        // Hydrate roster with player records
        const rosterPlayers = await Promise.all(
          rosterEntries.map(async (r) => ({
            ...r,
            player: await players.get(r.playerId),
          }))
        );
        const teamMatches = allMatches.filter(
          (m) => m.homeTeamId === team.id || m.awayTeamId === team.id
        );
        return ok({
          team,
          season,
          division,
          roster: rosterPlayers,
          matches: teamMatches,
        });
      }
      case 'player': {
        const slug = params.slug;
        if (!slug) return badRequest('slug required');
        const player = await players.getBySlug(slug);
        if (!player) return ok({ player: null });
        // Recompute career on read for freshness (cheap for now)
        await stats.recomputePlayerCareerStats(player.id);
        const fresh = await players.get(player.id);
        return ok({ player: fresh });
      }
      case 'all-seasons': {
        const all = await seasons.list();
        return ok({ seasons: all });
      }
      case 'sponsors': {
        const all = await sponsors.list();
        return ok({ sponsors: all });
      }
      default:
        return badRequest(`Unknown action: ${action}`);
    }
  } catch (err) {
    console.error(err);
    return serverError(err);
  }
};
