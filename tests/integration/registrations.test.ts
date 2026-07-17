import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { prisma } from "../../src/db/client.js";
import * as stripeService from "../../src/services/stripeService.js";

/**
 * POST /api/registrations — the public entry point, and the only place a team
 * name is reserved before any money moves.
 *
 * The Stripe session call is mocked; what is under test is the gate in front of
 * it: who may register, for how much, and under which names.
 */
vi.mock("../../src/services/stripeService.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/services/stripeService.js")>();
  return {
    ...actual,
    createCheckoutSession: vi.fn(async () => ({
      sessionId: `cs_test_${Math.random().toString(36).slice(2)}`,
      url: "https://checkout.stripe.test/session",
    })),
    refundSession: vi.fn(async () => {}),
  };
});

let app: FastifyInstance;
let tournamentId: string;
let categoryId: string;
let adminToken: string;

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
  await prisma.user.deleteMany({ where: { role: "ADMIN" } });

  const admin = await prisma.user.create({
    data: {
      email: `admin-${Date.now()}@test.ch`,
      name: "Admin",
      passwordHash: "x",
      role: "ADMIN",
      status: "APPROVED",
    },
  });
  adminToken = app.jwt.sign({ userId: admin.id, role: "ADMIN" });

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

const VALID = {
  teamName: "Falcons",
  contactName: "Anna Muster",
  contactEmail: "anna@test.ch",
  contactPhone: "079 000 00 00",
};

/**
 * Each call comes from a fresh IP, because the endpoint is rate-limited per IP
 * and real registrations arrive from different phones. Sharing one address here
 * would make the suite's 21st request a 429 and turn every later assertion into
 * a lie about the thing it claims to test. The limiter itself is tested below,
 * on purpose, from a single address.
 */
let ipCounter = 0;
function nextIp(): string {
  ipCounter += 1;
  return `10.9.${Math.floor(ipCounter / 250) % 250}.${(ipCounter % 250) + 1}`;
}

const register = (body: Record<string, unknown> = {}, remoteAddress = nextIp()) =>
  app.inject({
    method: "POST",
    url: "/api/registrations",
    remoteAddress,
    payload: { tournamentId, categoryId, ...VALID, ...body },
  });

describe("POST /registrations", () => {
  it("creates a pending registration and returns the checkout URL", async () => {
    const res = await register();

    expect(res.statusCode).toBe(201);
    expect(res.json().checkoutUrl).toBe("https://checkout.stripe.test/session");

    const reg = await prisma.registration.findUnique({ where: { id: res.json().registrationId } });
    expect(reg).toMatchObject({ status: "PENDING_PAYMENT", teamName: "Falcons", amountRp: 10000 });
    // The whole rule of this feature: no Team until the money arrives.
    expect(await prisma.team.count()).toBe(0);
  });

  it("snapshots the fee, so a later change cannot move the goalposts", async () => {
    const res = await register();
    await prisma.tournament.update({ where: { id: tournamentId }, data: { entryFeeRp: 25000 } });

    const reg = await prisma.registration.findUnique({ where: { id: res.json().registrationId } });
    expect(reg!.amountRp).toBe(10000);
  });

  it("holds the name for 30 minutes, mirroring the Stripe session", async () => {
    const res = await register();
    const reg = await prisma.registration.findUnique({ where: { id: res.json().registrationId } });
    const heldMin = (reg!.expiresAt.getTime() - reg!.createdAt.getTime()) / 60_000;
    expect(heldMin).toBeGreaterThan(28);
    expect(heldMin).toBeLessThan(32);
  });

  it("frees the name if Stripe never gives us a session", async () => {
    vi.mocked(stripeService.createCheckoutSession).mockRejectedValueOnce(new Error("Stripe down"));

    await register().catch(() => {});

    // A row that can never be paid must not hold the name hostage for 30 min.
    expect(await prisma.registration.count()).toBe(0);
  });
});

describe("registration window", () => {
  it("rejects when registration is closed", async () => {
    await prisma.tournament.update({
      where: { id: tournamentId },
      data: { registrationOpen: false },
    });

    const res = await register();

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("REGISTRATION_CLOSED");
  });

  it("rejects once the deadline has passed", async () => {
    await prisma.tournament.update({
      where: { id: tournamentId },
      data: { registrationDeadline: new Date(Date.now() - 60_000) },
    });

    const res = await register();

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("REGISTRATION_CLOSED");
  });

  it("accepts while the deadline is still ahead", async () => {
    await prisma.tournament.update({
      where: { id: tournamentId },
      data: { registrationDeadline: new Date(Date.now() + 3600_000) },
    });

    expect((await register()).statusCode).toBe(201);
  });

  it("rejects when no entry fee is configured", async () => {
    await prisma.tournament.update({ where: { id: tournamentId }, data: { entryFeeRp: 0 } });

    const res = await register();

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("REGISTRATION_NOT_CONFIGURED");
  });
});

describe("team name availability", () => {
  it("rejects a name an existing team already has", async () => {
    await prisma.team.create({ data: { categoryId, name: "Falcons" } });

    const res = await register();

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("TEAM_NAME_TAKEN");
  });

  it("compares case-insensitively", async () => {
    await prisma.team.create({ data: { categoryId, name: "FALCONS" } });

    const res = await register({ teamName: "falcons" });

    // Prisma's `mode: "insensitive"` is Postgres-only and this also runs on
    // SQLite; the comparison is done in JS so both behave the same.
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("TEAM_NAME_TAKEN");
  });

  it("rejects a name held by another pending checkout", async () => {
    await register();

    const second = await register({ contactEmail: "b@test.ch" });

    // The 30-minute hold is the point: two clubs must not both pay for one name.
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe("TEAM_NAME_TAKEN");
  });

  it("releases the name once the hold has expired", async () => {
    const first = await register();
    await prisma.registration.update({
      where: { id: first.json().registrationId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    expect((await register({ contactEmail: "b@test.ch" })).statusCode).toBe(201);
  });

  it("does not let a canceled registration block the name", async () => {
    const first = await register();
    await prisma.registration.update({
      where: { id: first.json().registrationId },
      data: { status: "CANCELED" },
    });

    expect((await register({ contactEmail: "b@test.ch" })).statusCode).toBe(201);
  });

  it("allows the same name in a different category", async () => {
    const other = await prisma.category.create({ data: { tournamentId, name: "Junioren E" } });
    await register();

    const res = await register({ categoryId: other.id, contactEmail: "b@test.ch" });

    expect(res.statusCode).toBe(201);
  });
});

describe("validation", () => {
  it.each([
    ["a one-letter team name", { teamName: "A" }],
    ["a 41-character team name", { teamName: "x".repeat(41) }],
    ["a malformed email", { contactEmail: "not-an-email" }],
    ["an empty phone", { contactPhone: "" }],
    ["an empty contact name", { contactName: "" }],
  ])("rejects %s", async (_label, body) => {
    expect((await register(body)).statusCode).toBe(400);
  });

  it("rejects a category from another tournament", async () => {
    const otherTournament = await prisma.tournament.create({
      data: {
        name: "Other",
        startAt: new Date(),
        matchDurationMin: 12,
        transitionMin: 3,
        pitchCount: 1,
        entryFeeRp: 10000,
        registrationOpen: true,
      },
    });
    const foreign = await prisma.category.create({
      data: { tournamentId: otherTournament.id, name: "Fremd" },
    });

    expect((await register({ categoryId: foreign.id })).statusCode).toBe(400);
  });
});

describe("rate limiting", () => {
  it("caps a single address, so team names cannot be squatted in a loop", async () => {
    const ip = "10.7.7.7";
    const codes: number[] = [];
    // Distinct names: each request must be rejected by the limiter, not by the
    // name check, or this would pass for the wrong reason.
    for (let i = 0; i < 21; i += 1) {
      const res = await register({ teamName: `Squat ${i}`, contactEmail: `s${i}@test.ch` }, ip);
      codes.push(res.statusCode);
    }

    expect(codes.filter((c) => c === 201)).toHaveLength(20);
    expect(codes.at(-1)).toBe(429);
  });

  it("does not punish a different club behind a different address", async () => {
    const ip = "10.7.7.8";
    for (let i = 0; i < 20; i += 1) {
      await register({ teamName: `Filler ${i}`, contactEmail: `f${i}@test.ch` }, ip);
    }

    const other = await register({ teamName: "Innocent", contactEmail: "i@test.ch" });

    expect(other.statusCode).toBe(201);
  });
});

describe("GET /registrations/:id/status", () => {
  it("returns status without leaking contact data", async () => {
    const created = await register();
    const id = created.json().registrationId;

    const res = await app.inject({ method: "GET", url: `/api/registrations/${id}/status` });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      status: "PENDING_PAYMENT",
      teamName: "Falcons",
      categoryName: "Junioren D",
    });
    // The id sits in a URL the payer may paste or share.
    const body = res.body;
    expect(body).not.toContain("anna@test.ch");
    expect(body).not.toContain("079 000 00 00");
    expect(body).not.toContain("Anna Muster");
  });

  it("404s an unknown id", async () => {
    const res = await app.inject({ method: "GET", url: "/api/registrations/nope/status" });
    expect(res.statusCode).toBe(404);
  });
});

describe("admin registration list", () => {
  it("returns contact data and the payment link for the admin", async () => {
    await register();

    const res = await app.inject({
      method: "GET",
      url: `/api/tournaments/${tournamentId}/registrations`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    const [row] = res.json().registrations;
    expect(row).toMatchObject({
      teamName: "Falcons",
      contactEmail: "anna@test.ch",
      contactPhone: "079 000 00 00",
      status: "PENDING_PAYMENT",
      categoryName: "Junioren D",
    });
    expect(row.stripeUrl).toContain("dashboard.stripe.com");
  });

  it("is admin-only — contact data is not public", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/tournaments/${tournamentId}/registrations`,
    });
    expect(res.statusCode).toBe(401);
  });
});
