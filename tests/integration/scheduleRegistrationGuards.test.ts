import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { prisma } from "../../src/db/client.js";

/**
 * Schedule generation vs. self-service registration.
 *
 * Both guards exist to stop the same disaster: a team that paid, and then does
 * not appear in the fixtures. One prevents registrations arriving after the
 * schedule is fixed; the other prevents a paid team being silently left out
 * because nobody put it in a group.
 */

let app: FastifyInstance;
let adminToken: string;
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
      email: `admin-${Date.now()}-${Math.random()}@test.ch`,
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
      registrationOpen: false,
      pitches: { create: [{ name: "Platz 1", sortOrder: 0 }] },
    },
  });
  tournamentId = tournament.id;
  const category = await prisma.category.create({
    data: { tournamentId: tournament.id, name: "Junioren D" },
  });
  categoryId = category.id;

  // A schedulable baseline: one group with two teams.
  const group = await prisma.group.create({ data: { categoryId: category.id, name: "A" } });
  await prisma.team.create({ data: { categoryId: category.id, groupId: group.id, name: "Alpha" } });
  await prisma.team.create({ data: { categoryId: category.id, groupId: group.id, name: "Beta" } });
});

const generate = () =>
  app.inject({
    method: "POST",
    url: `/api/tournaments/${tournamentId}/schedule/generate`,
    headers: { authorization: `Bearer ${adminToken}` },
  });

describe("schedule generation guards", () => {
  it("generates when registration is closed and every team has a group", async () => {
    const res = await generate();

    expect(res.statusCode).toBe(200);
    expect(res.json().matches).toBeGreaterThan(0);
  });

  it("refuses while registration is still open", async () => {
    await prisma.tournament.update({
      where: { id: tournamentId },
      data: { registrationOpen: true },
    });

    const res = await generate();

    // Otherwise a team could pay its way into an already-published schedule.
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("REGISTRATION_STILL_OPEN");
    expect(await prisma.match.count()).toBe(0);
  });

  it("refuses while a paid team is still unassigned, and names it", async () => {
    await prisma.team.create({ data: { categoryId, groupId: null, name: "Heimatlos" } });

    const res = await generate();

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("UNASSIGNED_TEAMS");
    // The admin has to find them, so the error carries them.
    const names = res.json().error.details.teams.map((t: { name: string }) => t.name);
    expect(names).toEqual(["Heimatlos"]);
    expect(await prisma.match.count()).toBe(0);
  });

  it("ignores unassigned teams belonging to another tournament", async () => {
    const other = await prisma.tournament.create({
      data: {
        name: "Other",
        startAt: new Date(),
        matchDurationMin: 12,
        transitionMin: 3,
        pitchCount: 1,
      },
    });
    const otherCat = await prisma.category.create({
      data: { tournamentId: other.id, name: "Fremd" },
    });
    await prisma.team.create({ data: { categoryId: otherCat.id, groupId: null, name: "Fremdteam" } });

    expect((await generate()).statusCode).toBe(200);
  });
});
