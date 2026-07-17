import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import Stripe from "stripe";
import { buildApp } from "../../src/app.js";
import { prisma } from "../../src/db/client.js";
import * as stripeService from "../../src/services/stripeService.js";

/**
 * The Stripe webhook: the only thing that turns money into a Team.
 *
 * Signature verification is real here — it is pure local crypto, so the suite
 * signs its own events with the test secret and exercises the same code path
 * production does. Only the two calls that would cross the network (session
 * create, refund) are mocked.
 */
vi.mock("../../src/services/stripeService.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/services/stripeService.js")>();
  return {
    ...actual,
    // Keep `constructEvent` real — verifying it is half the point of this file.
    createCheckoutSession: vi.fn(async () => ({
      sessionId: `cs_test_${Math.random().toString(36).slice(2)}`,
      url: "https://checkout.stripe.test/session",
    })),
    refundSession: vi.fn(async () => {}),
  };
});

const WEBHOOK_SECRET = "whsec_dummy_for_tests";

let app: FastifyInstance;
let tournamentId: string;
let categoryId: string;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  vi.clearAllMocks();
  await prisma.registration.deleteMany();
  await prisma.goal.deleteMany();
  await prisma.match.deleteMany();
  await prisma.slot.deleteMany();
  await prisma.team.deleteMany();
  await prisma.group.deleteMany();
  await prisma.category.deleteMany();
  await prisma.pitch.deleteMany();
  await prisma.tournament.deleteMany();

  const tournament = await prisma.tournament.create({
    data: {
      name: "Frick Cup",
      startAt: new Date("2026-05-16T09:00:00Z"),
      matchDurationMin: 12,
      transitionMin: 3,
      pitchCount: 2,
      status: "DRAFT",
      entryFeeRp: 10000,
      registrationOpen: true,
    },
  });
  tournamentId = tournament.id;
  const category = await prisma.category.create({
    data: { tournamentId: tournament.id, name: "Junioren D" },
  });
  categoryId = category.id;
});

/** A PENDING_PAYMENT registration, as POST /registrations would have left it. */
async function seedRegistration(teamName: string, overrides: Record<string, unknown> = {}) {
  return prisma.registration.create({
    data: {
      tournamentId,
      categoryId,
      teamName,
      contactName: "Anna Muster",
      contactEmail: `${teamName.replace(/\s/g, "").toLowerCase()}@test.ch`,
      contactPhone: "079 000 00 00",
      status: "PENDING_PAYMENT",
      amountRp: 10000,
      stripeSessionId: `cs_test_${teamName.replace(/\s/g, "")}_${Math.random().toString(36).slice(2)}`,
      expiresAt: new Date(Date.now() + 30 * 60_000),
      ...overrides,
    },
  });
}

/**
 * A real Stripe-signed webhook request. `generateTestHeaderString` is the same
 * HMAC Stripe uses, so this proves verification works rather than bypassing it.
 */
function post(eventType: string, registrationId: string | null, sessionId = "cs_test_x") {
  const payload = JSON.stringify({
    id: `evt_${Math.random().toString(36).slice(2)}`,
    object: "event",
    type: eventType,
    data: {
      object: {
        id: sessionId,
        object: "checkout.session",
        metadata: registrationId ? { registrationId } : {},
      },
    },
  });
  const signature = Stripe.webhooks.generateTestHeaderString({
    payload,
    secret: WEBHOOK_SECRET,
  });
  return app.inject({
    method: "POST",
    url: "/api/webhooks/stripe",
    headers: { "stripe-signature": signature, "content-type": "application/json" },
    payload,
  });
}

describe("checkout.session.completed", () => {
  it("creates the team and marks the registration paid", async () => {
    const reg = await seedRegistration("Falcons");

    const res = await post("checkout.session.completed", reg.id);

    expect(res.statusCode).toBe(200);
    const saved = await prisma.registration.findUnique({ where: { id: reg.id } });
    expect(saved).toMatchObject({ status: "PAID" });
    expect(saved!.paidAt).not.toBeNull();
    expect(saved!.teamId).toBeTruthy();

    const team = await prisma.team.findUnique({ where: { id: saved!.teamId! } });
    // Into the unassigned pool — the admin places it into a group in setup.
    expect(team).toMatchObject({ name: "Falcons", categoryId, groupId: null });
  });

  it("is idempotent — a replayed event does not create a second team", async () => {
    const reg = await seedRegistration("Falcons");

    await post("checkout.session.completed", reg.id);
    const replay = await post("checkout.session.completed", reg.id);

    // Stripe retries; a retry of a fulfilment that happened must be a no-op.
    expect(replay.statusCode).toBe(200);
    expect(await prisma.team.count({ where: { categoryId } })).toBe(1);
    expect(await prisma.registration.count({ where: { status: "PAID" } })).toBe(1);
  });

  it("acks an unknown registration id instead of retrying forever", async () => {
    const res = await post("checkout.session.completed", "reg_does_not_exist");

    expect(res.statusCode).toBe(200);
    expect(await prisma.team.count()).toBe(0);
  });

  it("acks an event with no registrationId metadata", async () => {
    const res = await post("checkout.session.completed", null);
    expect(res.statusCode).toBe(200);
  });
});

describe("signature verification", () => {
  it("rejects an unsigned request", async () => {
    const reg = await seedRegistration("Falcons");

    const res = await app.inject({
      method: "POST",
      url: "/api/webhooks/stripe",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        type: "checkout.session.completed",
        data: { object: { metadata: { registrationId: reg.id } } },
      }),
    });

    expect(res.statusCode).toBe(400);
    // The whole point: no signature, no team, no payment.
    expect(await prisma.team.count()).toBe(0);
    expect((await prisma.registration.findUnique({ where: { id: reg.id } }))!.status).toBe(
      "PENDING_PAYMENT",
    );
  });

  it("rejects a forged signature", async () => {
    const reg = await seedRegistration("Falcons");
    const payload = JSON.stringify({
      type: "checkout.session.completed",
      data: { object: { metadata: { registrationId: reg.id } } },
    });
    const wrong = Stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_attacker" });

    const res = await app.inject({
      method: "POST",
      url: "/api/webhooks/stripe",
      headers: { "stripe-signature": wrong, "content-type": "application/json" },
      payload,
    });

    expect(res.statusCode).toBe(400);
    expect(await prisma.team.count()).toBe(0);
  });

  it("rejects a tampered payload that keeps a valid signature header", async () => {
    const reg = await seedRegistration("Falcons");
    const signed = JSON.stringify({
      type: "checkout.session.expired",
      data: { object: { metadata: { registrationId: reg.id } } },
    });
    const signature = Stripe.webhooks.generateTestHeaderString({
      payload: signed,
      secret: WEBHOOK_SECRET,
    });
    const tampered = JSON.stringify({
      type: "checkout.session.completed",
      data: { object: { metadata: { registrationId: reg.id } } },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/webhooks/stripe",
      headers: { "stripe-signature": signature, "content-type": "application/json" },
      payload: tampered,
    });

    // Proves the signature is checked against the *raw* bytes: swapping the body
    // under a valid header must not pass.
    expect(res.statusCode).toBe(400);
    expect(await prisma.team.count()).toBe(0);
  });
});

describe("checkout.session.expired", () => {
  it("frees the held team name", async () => {
    const reg = await seedRegistration("Falcons");

    const res = await post("checkout.session.expired", reg.id);

    expect(res.statusCode).toBe(200);
    expect((await prisma.registration.findUnique({ where: { id: reg.id } }))!.status).toBe(
      "EXPIRED",
    );
  });

  it("never un-pays a registration that already completed", async () => {
    const reg = await seedRegistration("Falcons");
    await post("checkout.session.completed", reg.id);

    // Stripe can deliver events out of order; expiry must not undo a payment.
    const res = await post("checkout.session.expired", reg.id);

    expect(res.statusCode).toBe(200);
    expect((await prisma.registration.findUnique({ where: { id: reg.id } }))!.status).toBe("PAID");
    expect(await prisma.team.count({ where: { categoryId } })).toBe(1);
  });
});

describe("unhandled events", () => {
  it("acks events it does not care about", async () => {
    const res = await post("payment_intent.succeeded", null);
    expect(res.statusCode).toBe(200);
  });
});

describe("name collision race", () => {
  it("refunds and cancels the loser when two payers take the same name", async () => {
    const first = await seedRegistration("Falcons");
    const second = await seedRegistration("Falcons");

    await post("checkout.session.completed", first.id);
    const loser = await post("checkout.session.completed", second.id);

    // Rare, but it must not crash the webhook — Stripe would retry forever.
    expect(loser.statusCode).toBe(200);
    expect((await prisma.registration.findUnique({ where: { id: first.id } }))!.status).toBe("PAID");
    expect((await prisma.registration.findUnique({ where: { id: second.id } }))!.status).toBe(
      "CANCELED",
    );
    expect(await prisma.team.count({ where: { categoryId } })).toBe(1);
    expect(stripeService.refundSession).toHaveBeenCalledWith(second.stripeSessionId);
  });

  it("treats a name that differs only in case as a collision", async () => {
    const first = await seedRegistration("Falcons");
    const second = await seedRegistration("falcons");

    await post("checkout.session.completed", first.id);
    await post("checkout.session.completed", second.id);

    // The unique index is exact-match, so this case is caught by the in-transaction
    // check. "Falcons" and "falcons" on one scoreboard is the same team name.
    expect((await prisma.registration.findUnique({ where: { id: second.id } }))!.status).toBe(
      "CANCELED",
    );
    expect(await prisma.team.count({ where: { categoryId } })).toBe(1);
    expect(stripeService.refundSession).toHaveBeenCalledTimes(1);
  });

  it("still cancels when the refund itself fails", async () => {
    vi.mocked(stripeService.refundSession).mockRejectedValueOnce(new Error("Stripe down"));
    const first = await seedRegistration("Falcons");
    const second = await seedRegistration("Falcons");

    await post("checkout.session.completed", first.id);
    const loser = await post("checkout.session.completed", second.id);

    // A failed refund must not make Stripe retry a fulfilment. It is logged and
    // left for the dashboard; the admin list carries the payment link.
    expect(loser.statusCode).toBe(200);
    expect((await prisma.registration.findUnique({ where: { id: second.id } }))!.status).toBe(
      "CANCELED",
    );
  });

  it("lets the same name into a different category", async () => {
    const other = await prisma.category.create({
      data: { tournamentId, name: "Junioren E" },
    });
    const first = await seedRegistration("Falcons");
    const second = await seedRegistration("Falcons", { categoryId: other.id });

    await post("checkout.session.completed", first.id);
    await post("checkout.session.completed", second.id);

    // Names are only unique within a category.
    expect((await prisma.registration.findUnique({ where: { id: second.id } }))!.status).toBe(
      "PAID",
    );
    expect(await prisma.team.count()).toBe(2);
    expect(stripeService.refundSession).not.toHaveBeenCalled();
  });
});
