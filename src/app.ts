import Fastify, { type FastifyInstance } from "fastify";

// The exact request text, kept by the JSON parser below for Stripe's signature
// verification. Unused by every other route.
declare module "fastify" {
  interface FastifyRequest {
    rawBody?: string;
  }
}
import rateLimit from "@fastify/rate-limit";
import { registerAuth } from "./plugins/auth.js";
import { registerErrorHandler } from "./plugins/errorHandler.js";
import { authRoutes } from "./routes/auth.js";
import { adminRefereeRoutes } from "./routes/adminReferees.js";
import { tournamentRoutes } from "./routes/tournaments.js";
import { structureRoutes } from "./routes/structure.js";
import { scheduleRoutes } from "./routes/schedule.js";
import { knockoutRoutes } from "./routes/knockout.js";
import { refereeRoutes } from "./routes/referee.js";
import { scoringRoutes } from "./routes/scoring.js";
import { matchRoutes } from "./routes/matches.js";
import { adminLiveRoutes } from "./routes/adminLive.js";
import { publicRoutes } from "./routes/publicViews.js";
import { eventRoutes } from "./routes/events.js";
import { pushRoutes } from "./routes/push.js";
import { registrationRoutes } from "./routes/registrations.js";
import { adminRegistrationRoutes } from "./routes/adminRegistrations.js";
import { stripeWebhookRoutes } from "./routes/stripeWebhook.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });

  // Many mutating endpoints (start, finish, approve, generate) take no body.
  // Treat an empty application/json body as {} instead of erroring.
  //
  // This parser also keeps the untouched text on `request.rawBody`. The Stripe
  // webhook verifies its signature over the exact bytes Stripe signed, and
  // `JSON.parse(...)` then re-serialising is not byte-identical — key order and
  // whitespace are lost, so the HMAC would never match. Capturing it here rather
  // than registering a second parser keeps one code path for every request:
  // parser precedence between encapsulated scopes is subtle, and getting it
  // wrong fails *closed* in a way that only shows up against real Stripe traffic.
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (req, body, done) => {
      const text = typeof body === "string" ? body : "";
      req.rawBody = text;
      const trimmed = text.trim();
      if (trimmed.length === 0) return done(null, {});
      try {
        done(null, JSON.parse(trimmed));
      } catch (err) {
        (err as { statusCode?: number }).statusCode = 400;
        done(err as Error, undefined);
      }
    },
  );

  registerErrorHandler(app);
  await app.register(rateLimit, { global: false, max: 300, timeWindow: "1 minute" });
  await registerAuth(app);

  app.get("/health", async () => ({ status: "ok" }));

  const modules = [
    authRoutes,
    adminRefereeRoutes,
    tournamentRoutes,
    structureRoutes,
    scheduleRoutes,
    knockoutRoutes,
    refereeRoutes,
    scoringRoutes,
    matchRoutes,
    adminLiveRoutes,
    publicRoutes,
    eventRoutes,
    pushRoutes,
    registrationRoutes,
    adminRegistrationRoutes,
    stripeWebhookRoutes,
  ];
  for (const register of modules) {
    await app.register(register, { prefix: "/api" });
  }

  return app;
}
