// netlify/functions/register.js
// Captain submits team registration → admin reviews → on approval, captain pays via Stripe

import { registrations, seasons, divisions, teams } from '../lib/db.js';
import { ok, badRequest, serverError, cors } from '../lib/response.js';

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return cors();
  if (event.httpMethod !== 'POST') return badRequest('POST only');

  try {
    const body = JSON.parse(event.body || '{}');
    const { captainName, captainEmail, captainPhone, teamName, divisionId, seasonId, notes } = body;

    if (!captainName || !captainEmail || !teamName || !divisionId || !seasonId) {
      return badRequest('Missing required fields');
    }

    // Check capacity
    const division = await divisions.get(seasonId, divisionId);
    if (!division) return badRequest('Invalid division');

    const teamsInDivision = await teams.listBySeasonAndDivision(seasonId, divisionId);
    if (teamsInDivision.length >= division.capacity) {
      return badRequest(`Division "${division.name}" is full`);
    }

    const reg = await registrations.create({
      captainName,
      captainEmail,
      captainPhone,
      teamName,
      divisionId,
      seasonId,
      notes,
    });

    // TODO: send email to admin (via Netlify Email or SendGrid)

    return ok({ registration: reg, message: 'Registration received! We\'ll be in touch within 48 hours.' });
  } catch (err) {
    console.error(err);
    return serverError(err);
  }
};
