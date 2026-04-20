// netlify/functions/stripe-webhook.js
import Stripe from 'stripe';
import { registrations, teams } from '../lib/db.js';
import { ok, badRequest, serverError } from '../lib/response.js';

export const handler = async (event) => {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const sig = event.headers['stripe-signature'];
  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(
      event.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    return badRequest(`Webhook signature failed: ${err.message}`);
  }
  try {
    if (stripeEvent.type === 'checkout.session.completed') {
      const session = stripeEvent.data.object;
      const regId = session.metadata?.registrationId;
      const teamId = session.metadata?.teamId;
      if (regId) await registrations.update(regId, { status: 'paid', paidAt: new Date().toISOString() });
      if (teamId) await teams.update(teamId, { paymentStatus: 'paid', paidAt: new Date().toISOString() });
    }
    return ok({ received: true });
  } catch (err) {
    console.error(err);
    return serverError(err);
  }
};
