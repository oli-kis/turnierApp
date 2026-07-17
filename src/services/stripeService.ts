import Stripe from "stripe";
import { env } from "../lib/env.js";

/**
 * Stripe Checkout — the club's entry-fee collection.
 *
 * Optional by construction, like push: without `STRIPE_SECRET_KEY` the feature
 * reports itself unconfigured and every call throws a typed error the routes
 * turn into `REGISTRATION_NOT_CONFIGURED`. A server that never intends to take
 * money must still boot, and the tests must not need a Stripe account.
 */

const secret = env.STRIPE_SECRET_KEY;

export const stripe = secret ? new Stripe(secret) : null;

/** Stripe configured AND able to send the payer back somewhere. */
export function isStripeConfigured(): boolean {
  return Boolean(stripe && env.PUBLIC_BASE_URL);
}

/**
 * The payer's return origin, without a trailing slash.
 *
 * Normalised because this is hand-edited in `.env` and "https://example.ch/" is
 * at least as natural to write as "https://example.ch" — but the former would
 * build "…ch//t/123", and Stripe rejects a malformed return URL only sometimes,
 * which is worse than always.
 */
function baseUrl(): string | null {
  const raw = env.PUBLIC_BASE_URL;
  return raw ? raw.replace(/\/+$/, "") : null;
}

/** The client, or a throw — so callers can't silently proceed without one. */
function client(): Stripe {
  if (!stripe) throw new Error("Stripe is not configured (STRIPE_SECRET_KEY missing)");
  return stripe;
}

/** Checkout Sessions expire after 30 min minimum — that is also our name hold. */
export const HOLD_MINUTES = 30;

export interface CheckoutParams {
  registrationId: string;
  tournamentId: string;
  tournamentName: string;
  categoryName: string;
  amountRp: number;
  contactEmail: string;
  expiresAt: Date;
}

export interface CheckoutResult {
  sessionId: string;
  url: string;
}

export async function createCheckoutSession(p: CheckoutParams): Promise<CheckoutResult> {
  const base = baseUrl();
  if (!base) throw new Error("PUBLIC_BASE_URL is not configured");

  const session = await client().checkout.sessions.create({
    mode: "payment",
    // TWINT first: it is how most Swiss club payers will actually pay. It is
    // CHF-only and single-use, which is exactly this transaction's shape.
    payment_method_types: ["twint", "card"],
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "chf",
          unit_amount: p.amountRp,
          product_data: { name: `Startgeld ${p.tournamentName} — ${p.categoryName}` },
        },
      },
    ],
    customer_email: p.contactEmail,
    // The webhook's only handle back to us. Everything else on the session is
    // Stripe's; this is ours.
    metadata: { registrationId: p.registrationId },
    expires_at: Math.floor(p.expiresAt.getTime() / 1000),
    success_url: `${base}/t/${p.tournamentId}/anmeldung/status?rid=${p.registrationId}`,
    cancel_url: `${base}/t/${p.tournamentId}/anmelden`,
  });

  if (!session.url) throw new Error("Stripe returned a session without a checkout URL");
  return { sessionId: session.id, url: session.url };
}

/**
 * Verify a webhook against the raw body. Throws on a bad signature — which the
 * route must answer with 400, never 200: a forged event that we ack is a team
 * registered without paying.
 */
export function constructEvent(rawBody: string | Buffer, signature: string): Stripe.Event {
  const secretKey = env.STRIPE_WEBHOOK_SECRET;
  if (!secretKey) throw new Error("STRIPE_WEBHOOK_SECRET is not configured");
  return client().webhooks.constructEvent(rawBody, signature, secretKey);
}

/**
 * Refund a session's payment. Used only on the name-collision path, where we
 * took money for a team we cannot create.
 */
export async function refundSession(stripeSessionId: string): Promise<void> {
  const session = await client().checkout.sessions.retrieve(stripeSessionId);
  const paymentIntent =
    typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  if (!paymentIntent) throw new Error(`Session ${stripeSessionId} has no payment intent to refund`);
  await client().refunds.create({ payment_intent: paymentIntent });
}

/** Deep link to the payment for the admin UI — refunds are done in the dashboard. */
export function dashboardUrl(stripeSessionId: string): string {
  return `https://dashboard.stripe.com/payments/${stripeSessionId}`;
}
