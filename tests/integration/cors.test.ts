import { describe, it, expect, vi, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";

/**
 * Cross-origin access for a deployed frontend.
 *
 * This is configuration, and configuration that fails *silently on the server*:
 * a wrong CORS_ORIGIN produces a perfectly healthy API and a blocked request in
 * someone else's browser, which is the hardest kind of thing to debug remotely.
 * So the shapes people actually paste into a hosting dashboard are pinned here.
 */

const ORIGIN = "https://turnier.vercel.app";

let app: FastifyInstance | undefined;

async function buildWith(corsOrigin: string | undefined): Promise<FastifyInstance> {
  vi.resetModules();
  if (corsOrigin === undefined) delete process.env.CORS_ORIGIN;
  else process.env.CORS_ORIGIN = corsOrigin;
  const { buildApp } = await import("../../src/app.js");
  app = await buildApp();
  return app;
}

afterEach(async () => {
  await app?.close();
  app = undefined;
  delete process.env.CORS_ORIGIN;
});

describe("CORS", () => {
  it("allows a configured origin", async () => {
    const server = await buildWith(ORIGIN);

    const res = await server.inject({
      method: "GET",
      url: "/api/tournaments",
      headers: { origin: ORIGIN },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe(ORIGIN);
  });

  it("answers the preflight a JSON request with a bearer token triggers", async () => {
    const server = await buildWith(ORIGIN);

    // Any Authorization/Content-Type header makes the browser preflight first.
    // If this fails, every admin and referee write fails while GETs still work.
    const res = await server.inject({
      method: "OPTIONS",
      url: "/api/matches/m_1/goals",
      headers: {
        origin: ORIGIN,
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization,content-type",
      },
    });

    expect(res.statusCode).toBeLessThan(300);
    expect(res.headers["access-control-allow-origin"]).toBe(ORIGIN);
    expect(String(res.headers["access-control-allow-methods"])).toContain("POST");
    expect(String(res.headers["access-control-allow-headers"]).toLowerCase()).toContain(
      "authorization",
    );
  });

  it("refuses an origin that is not configured", async () => {
    const server = await buildWith(ORIGIN);

    const res = await server.inject({
      method: "GET",
      url: "/api/tournaments",
      headers: { origin: "https://evil.example" },
    });

    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("accepts a comma-separated list and tolerates spaces and trailing slashes", async () => {
    // What a Render env field ends up holding after two rounds of copy-paste.
    const server = await buildWith(` ${ORIGIN}/, https://preview.vercel.app `);

    for (const origin of [ORIGIN, "https://preview.vercel.app"]) {
      const res = await server.inject({
        method: "GET",
        url: "/api/tournaments",
        headers: { origin },
      });
      expect(res.headers["access-control-allow-origin"]).toBe(origin);
    }
  });

  it("stays off when unset, so local dev is unchanged", async () => {
    // Dev and preview reach the API through Vite's proxy: same-origin, no CORS.
    // Unset must mean "no cross-origin callers", never "any".
    const server = await buildWith(undefined);

    const res = await server.inject({
      method: "GET",
      url: "/api/tournaments",
      headers: { origin: ORIGIN },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
