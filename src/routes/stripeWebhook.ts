import type { FastifyInstance } from "fastify";
import type Stripe from "stripe";
import { env } from "../lib/env.js";
import { constructEvent } from "../services/stripeService.js";
import { expireRegistration, fulfilRegistration } from "../services/registrationService.js";

/**
 * Stripe webhook — the only thing that turns money into a Team.
 *
 * Two rules, and they pull in opposite directions:
 *
 * 1. **Never trust an unverified event.** A forged `checkout.session.completed`
 *    is a team registered without paying, so a bad signature is a `400` and
 *    nothing else. This is the one place where refusing to ack is correct.
 * 2. **Never 500 on business-level noise.** Stripe retries non-2xx for days.
 *    An event we don't handle, an id we don't know, a state already reached —
 *    all are `200`, because retrying them would change nothing and the retries
 *    would bury the events that matter.
 */
export async function stripeWebhookRoutes(app: FastifyInstance): Promise<void> {
  app.post("/webhooks/stripe", async (request, reply) => {
    if (!env.STRIPE_WEBHOOK_SECRET) {
      // Nothing can be verified, so nothing can be trusted. 503 (not 200) so a
      // misconfigured deployment shows up in Stripe's dashboard as failing
      // delivery rather than silently discarding real payments.
      request.log.error("Stripe webhook called but STRIPE_WEBHOOK_SECRET is not configured");
      return reply.status(503).send({ error: { code: "NOT_CONFIGURED" } });
    }

    const signature = request.headers["stripe-signature"];
    if (typeof signature !== "string") {
      return reply.status(400).send({ error: { code: "MISSING_SIGNATURE" } });
    }

    // The bytes Stripe signed, kept by the JSON parser in app.ts. The parsed
    // body is useless here — re-serialising it would not reproduce the HMAC.
    const raw = request.rawBody;
    if (raw === undefined) {
      request.log.error("Stripe webhook: rawBody missing — the JSON parser is not capturing it");
      return reply.status(400).send({ error: { code: "MISSING_BODY" } });
    }

    let event: Stripe.Event;
    try {
      event = constructEvent(raw, signature);
    } catch (err) {
      request.log.warn({ err }, "Stripe webhook signature verification failed");
      return reply.status(400).send({ error: { code: "INVALID_SIGNATURE" } });
    }

    try {
      switch (event.type) {
        case "checkout.session.completed": {
          const registrationId = registrationIdOf(event);
          if (registrationId) await fulfilRegistration(registrationId);
          break;
        }
        case "checkout.session.expired": {
          const registrationId = registrationIdOf(event);
          if (registrationId) await expireRegistration(registrationId);
          break;
        }
        default:
          // Not ours. Ack so Stripe stops asking.
          break;
      }
    } catch (err) {
      // A genuine bug in fulfilment. 500 lets Stripe retry, which is what we
      // want for a transient failure — fulfilment is idempotent, so a retry of
      // a partially-applied event is safe.
      request.log.error({ err, eventId: event.id }, "Stripe webhook handler failed");
      return reply.status(500).send({ error: { code: "HANDLER_FAILED" } });
    }

    return reply.status(200).send({ received: true });
  });
}

/** Our own handle on the session; set as metadata when the session was created. */
function registrationIdOf(event: Stripe.Event): string | null {
  const session = event.data.object as Stripe.Checkout.Session;
  return session.metadata?.registrationId ?? null;
}
