import Fastify, { type FastifyInstance } from "fastify";
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

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });

  // Many mutating endpoints (start, finish, approve, generate) take no body.
  // Treat an empty application/json body as {} instead of erroring.
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_req, body, done) => {
      const text = typeof body === "string" ? body.trim() : "";
      if (text.length === 0) return done(null, {});
      try {
        done(null, JSON.parse(text));
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
  ];
  for (const register of modules) {
    await app.register(register, { prefix: "/api" });
  }

  return app;
}
