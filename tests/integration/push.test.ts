import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { prisma } from "../../src/db/client.js";

/**
 * Push subscribe/unsubscribe.
 *
 * Note these run with no VAPID keypair configured (the test env has none), which
 * is itself the case worth pinning: the endpoints must behave sanely on a
 * machine that has never heard of push, because that is every dev machine and CI.
 */

let app: FastifyInstance;
let refereeToken: string;
let refereeId: string;
let otherToken: string;
let otherId: string;
let adminToken: string;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

async function makeUser(role: "REFEREE" | "ADMIN", status: "APPROVED" | "PENDING" = "APPROVED") {
  return prisma.user.create({
    data: {
      email: `${role}-${Date.now()}-${Math.random()}@test.ch`,
      name: role,
      passwordHash: "x",
      role,
      status,
    },
  });
}

beforeEach(async () => {
  await prisma.pushSubscription.deleteMany();
  await prisma.user.deleteMany({ where: { role: "REFEREE" } });

  const ref = await makeUser("REFEREE");
  refereeId = ref.id;
  refereeToken = app.jwt.sign({ userId: ref.id, role: "REFEREE" });

  const other = await makeUser("REFEREE");
  otherId = other.id;
  otherToken = app.jwt.sign({ userId: other.id, role: "REFEREE" });

  const admin = await makeUser("ADMIN");
  adminToken = app.jwt.sign({ userId: admin.id, role: "ADMIN" });
});

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

const SUB = {
  endpoint: "https://push.example.test/abc",
  keys: { p256dh: "key-material", auth: "auth-secret" },
};

const subscribe = (token: string, body: unknown = SUB) =>
  app.inject({ method: "POST", url: "/api/push/subscribe", headers: auth(token), payload: body });

const unsubscribe = (token: string, endpoint: string) =>
  app.inject({
    method: "POST",
    url: "/api/push/unsubscribe",
    headers: auth(token),
    payload: { endpoint },
  });

describe("GET /push/public-key", () => {
  it("reports push unavailable when no VAPID keypair is configured", async () => {
    const res = await app.inject({ method: "GET", url: "/api/push/public-key" });

    // The client uses this to decide whether to offer the toggle at all; an
    // offer it cannot honour is worse than no offer.
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ enabled: false, key: null });
  });

  it("is public — the client needs it before it has a token", async () => {
    const res = await app.inject({ method: "GET", url: "/api/push/public-key" });
    expect(res.statusCode).toBe(200);
  });
});

describe("POST /push/subscribe", () => {
  it("stores the subscription for the calling referee", async () => {
    const res = await subscribe(refereeToken);

    expect(res.statusCode).toBe(201);
    const rows = await prisma.pushSubscription.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: refereeId,
      endpoint: SUB.endpoint,
      p256dh: "key-material",
      auth: "auth-secret",
    });
  });

  it("refreshes rather than duplicates when the same device re-subscribes", async () => {
    await subscribe(refereeToken);
    await subscribe(refereeToken, { ...SUB, keys: { p256dh: "rotated", auth: "rotated-auth" } });

    const rows = await prisma.pushSubscription.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].p256dh).toBe("rotated");
  });

  it("moves a handed-down phone to the referee now logged in on it", async () => {
    await subscribe(refereeToken);
    await subscribe(otherToken);

    // Keyed on endpoint, not (user, endpoint): the previous referee must stop
    // being notified on a phone that is no longer theirs.
    const rows = await prisma.pushSubscription.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(otherId);
  });

  it("keeps a referee's several devices side by side", async () => {
    await subscribe(refereeToken);
    await subscribe(refereeToken, { ...SUB, endpoint: "https://push.example.test/second" });

    expect(await prisma.pushSubscription.count({ where: { userId: refereeId } })).toBe(2);
  });

  it("rejects an anonymous caller", async () => {
    const res = await app.inject({ method: "POST", url: "/api/push/subscribe", payload: SUB });

    expect(res.statusCode).toBe(401);
    expect(await prisma.pushSubscription.count()).toBe(0);
  });

  it("rejects an admin — push is the referee's channel", async () => {
    const res = await subscribe(adminToken);
    expect(res.statusCode).toBe(403);
  });

  it("rejects a referee still waiting for approval", async () => {
    const pending = await makeUser("REFEREE", "PENDING");
    const token = app.jwt.sign({ userId: pending.id, role: "REFEREE" });

    const res = await subscribe(token);

    expect(res.statusCode).toBe(403);
    expect(await prisma.pushSubscription.count()).toBe(0);
  });

  it("rejects a malformed subscription", async () => {
    const res = await subscribe(refereeToken, { endpoint: "not-a-url", keys: { p256dh: "a" } });
    expect(res.statusCode).toBe(400);
  });
});

describe("POST /push/unsubscribe", () => {
  it("removes the subscription", async () => {
    await subscribe(refereeToken);
    const res = await unsubscribe(refereeToken, SUB.endpoint);

    expect(res.statusCode).toBe(200);
    expect(await prisma.pushSubscription.count()).toBe(0);
  });

  it("is idempotent — unsubscribing twice is success", async () => {
    await subscribe(refereeToken);
    await unsubscribe(refereeToken, SUB.endpoint);
    const again = await unsubscribe(refereeToken, SUB.endpoint);

    // The caller's intent ("this endpoint must not be notified") is satisfied.
    expect(again.statusCode).toBe(200);
  });

  it("leaves the referee's other devices alone", async () => {
    await subscribe(refereeToken);
    await subscribe(refereeToken, { ...SUB, endpoint: "https://push.example.test/second" });

    await unsubscribe(refereeToken, SUB.endpoint);

    const rows = await prisma.pushSubscription.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].endpoint).toBe("https://push.example.test/second");
  });
});
