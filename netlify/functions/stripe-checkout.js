// netlify/functions/stripe-checkout.js
// Create a Stripe checkout session for $450 team registration

import Stripe from 'stripe';
import { registrations, teams, divisions, seasons } from './lib/db.js';
import { ok, badRequest, serverError, cors } from './lib/response.js';

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return cors();
  if (event.httpMethod !== 'POST') return badRequest('POST only');
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  try {
    const { registrationId } = JSON.parse(event.body || '{}');
    if (!registrationId) return badRequest('registrationId required');
    const reg = await registrations.get(registrationId);
    if (!reg) return badRequest('Invalid registration');
    if (reg.status !== 'approved') return badRequest('Registration not yet approved');
    if (reg.status === 'paid') return badRequest('Already paid');
    const division = await divisions.get(reg.seasonId, reg.divisionId);
    const season = await seasons.get(reg.seasonId);
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            unit_amount: (division?.price || 450) * 100,
            product_data: {
              name: `${reg.teamName} – ${season?.name || 'Season'} (${division?.name || ''})`,
              description: 'Just Dink It · South Bay Pickleball League team registration',
            },
          },
          quantity: 1,
        },
      ],
      customer_email: reg.captainEmail,
      success_url: `${process.env.URL || 'http://localhost:8888'}/registration-success?reg=${reg.id}`,
      cancel_url: `${process.env.URL || 'http://localhost:8888'}/register?canceled=1`,
      metadata: {
        registrationId: reg.id,
        teamId: reg.teamId || '',
        captainId: reg.captainId || '',
      },
    });
    await registrations.update(reg.id, { stripeSessionId: session.id });
    if (reg.teamId) await teams.update(reg.teamId, { stripeSessionId: session.id });
    return ok({ url: session.url, sessionId: session.id });
  } catch (err) {
    console.error(err);
    return serverError(err);
  }
};
