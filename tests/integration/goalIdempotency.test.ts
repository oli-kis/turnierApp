import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { prisma } from "../../src/db/client.js";

/**
 * POST /matches/:id/goals is idempotent on `clientId`. The referee app queues
 * goals tapped while offline and replays them on reconnect; a request whose
 * response was lost in flight must not double-count on replay.
 */

let app: FastifyInstance;
let refereeToken: string;
let refereeId: string;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.goal.deleteMany();
  await prisma.match.deleteMany();
  await prisma.slot.deleteMany();
  await prisma.team.deleteMany();
  await prisma.group.deleteMany();
  await prisma.category.deleteMany();
  await prisma.pitch.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.tournament.deleteMany();
  await prisma.user.deleteMany({ where: { role: "REFEREE" } });

  const ref = await prisma.user.create({
    data: {
      email: `ref-${Date.now()}-${Math.random()}@test.ch`,
      name: "Ref",
      passwordHash: "x",
      role: "REFEREE",
      status: "APPROVED",
    },
  });
  refereeId = ref.id;
  refereeToken = app.jwt.sign({ userId: ref.id, role: "REFEREE" });
});

const authHeader = () => ({ authorization: `Bearer ${refereeToken}` });

async function seed(matchStatus: "RUNNING" | "FINISHED" = "RUNNING") {
  const tournament = await prisma.tournament.create({
    data: {
      name: "T",
      startAt: new Date(),
      matchDurationMin: 12,
      transitionMin: 3,
      pitchCount: 1,
      status: "RUNNING",
    },
  });
  const category = await prisma.category.create({
    data: { tournamentId: tournament.id, name: "Cat" },
  });
  const group = await prisma.group.create({ data: { categoryId: category.id, name: "A" } });
  const home = await prisma.team.create({
    data: { categoryId: category.id, groupId: group.id, name: "Home" },
  });
  const away = await prisma.team.create({
    data: { categoryId: category.id, groupId: group.id, name: "Away" },
  });
  const slot = await prisma.slot.create({
    data: {
      tournamentId: tournament.id,
      index: 0,
      plannedStart: new Date(),
      actualStart: new Date(),
      status: matchStatus === "RUNNING" ? "RUNNING" : "FINISHED",
    },
  });
  const match = await prisma.match.create({
    data: {
      tournamentId: tournament.id,
      categoryId: category.id,
      groupId: group.id,
      slotId: slot.id,
      pitchId: null,
      phase: "GROUP",
      status: matchStatus,
      homeTeamId: home.id,
      awayTeamId: away.id,
      refereeId,
      scoreHome: 0,
      scoreAway: 0,
    },
  });
  return { tournament, match, home, away };
}

const postGoal = (matchId: string, teamId: string, clientId?: string) =>
  app.inject({
    method: "POST",
    url: `/api/matches/${matchId}/goals`,
    headers: authHeader(),
    payload: clientId ? { teamId, clientId } : { teamId },
  });

describe("POST /matches/:id/goals idempotency", () => {
  it("creates the goal on first send", async () => {
    const { match, home } = await seed();
    const res = await postGoal(match.id, home.id, "c-1");

    expect(res.statusCode).toBe(201);
    expect(res.json().goalId).toBeTruthy();
    expect((await prisma.match.findUnique({ where: { id: match.id } }))!.scoreHome).toBe(1);
  });

  it("returns the same goal without double-counting when the same clientId is replayed", async () => {
    const { match, home } = await seed();
    const first = await postGoal(match.id, home.id, "c-1");
    const replay = await postGoal(match.id, home.id, "c-1");

    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual({ goalId: first.json().goalId, duplicate: true });
    expect(await prisma.goal.count({ where: { matchId: match.id } })).toBe(1);
    expect((await prisma.match.findUnique({ where: { id: match.id } }))!.scoreHome).toBe(1);
  });

  it("reports success for a replay that arrives after the match is finished", async () => {
    const { match, home } = await seed();
    await postGoal(match.id, home.id, "c-1");
    await prisma.match.update({ where: { id: match.id }, data: { status: "FINISHED" } });

    const replay = await postGoal(match.id, home.id, "c-1");

    // The goal IS recorded — MATCH_NOT_RUNNING here would strand the outbox item.
    expect(replay.statusCode).toBe(200);
    expect(replay.json().duplicate).toBe(true);
    expect((await prisma.match.findUnique({ where: { id: match.id } }))!.scoreHome).toBe(1);
  });

  it("still rejects a genuinely new goal on a finished match", async () => {
    const { match, home } = await seed("FINISHED");
    const res = await postGoal(match.id, home.id, "c-new");

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("MATCH_NOT_RUNNING");
    expect(await prisma.goal.count()).toBe(0);
  });

  it("counts distinct clientIds separately", async () => {
    const { match, home } = await seed();
    await postGoal(match.id, home.id, "c-1");
    await postGoal(match.id, home.id, "c-2");

    expect((await prisma.match.findUnique({ where: { id: match.id } }))!.scoreHome).toBe(2);
  });

  it("counts every goal when no clientId is sent (online path unchanged)", async () => {
    const { match, home } = await seed();
    await postGoal(match.id, home.id);
    await postGoal(match.id, home.id);

    expect((await prisma.match.findUnique({ where: { id: match.id } }))!.scoreHome).toBe(2);
    expect(await prisma.goal.count({ where: { matchId: match.id } })).toBe(2);
  });

  it("rejects a clientId reused across matches", async () => {
    const { match, home } = await seed();
    const other = await seed();
    await postGoal(match.id, home.id, "c-1");

    const res = await postGoal(other.match.id, other.home.id, "c-1");
    expect(res.statusCode).toBe(400);
    expect((await prisma.match.findUnique({ where: { id: other.match.id } }))!.scoreHome).toBe(0);
  });

  it("does not double-count when two replays race", async () => {
    const { match, home } = await seed();
    const results = await Promise.all([
      postGoal(match.id, home.id, "c-race"),
      postGoal(match.id, home.id, "c-race"),
      postGoal(match.id, home.id, "c-race"),
    ]);

    expect(results.every((r) => r.statusCode === 200 || r.statusCode === 201)).toBe(true);
    const goalIds = new Set(results.map((r) => r.json().goalId));
    expect(goalIds.size).toBe(1);
    expect(await prisma.goal.count({ where: { matchId: match.id } })).toBe(1);
    expect((await prisma.match.findUnique({ where: { id: match.id } }))!.scoreHome).toBe(1);
  });
});
