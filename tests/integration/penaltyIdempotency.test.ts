import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { prisma } from "../../src/db/client.js";

/**
 * POST /matches/:id/penalties is idempotent on the submitted result.
 *
 * The referee app queues the penalty result tapped while offline and replays it
 * on reconnect. Unlike a goal this needs no clientId: the result is a value, not
 * a countable event, so an identical resubmission is a no-op by definition.
 * What matters is that a replay whose original response was lost reports success
 * instead of MATCH_NOT_RUNNING — by replay time the match it decided is,
 * necessarily, already finished.
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

/** A drawn knockout match — the only situation penalties apply to. */
async function seed(opts: { scoreHome?: number; scoreAway?: number; phase?: "FINAL" | "GROUP" } = {}) {
  const { scoreHome = 1, scoreAway = 1, phase = "FINAL" } = opts;
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
  const home = await prisma.team.create({ data: { categoryId: category.id, name: "Home" } });
  const away = await prisma.team.create({ data: { categoryId: category.id, name: "Away" } });
  const slot = await prisma.slot.create({
    data: {
      tournamentId: tournament.id,
      index: 0,
      plannedStart: new Date(),
      actualStart: new Date(),
      status: "RUNNING",
    },
  });
  const match = await prisma.match.create({
    data: {
      tournamentId: tournament.id,
      categoryId: category.id,
      slotId: slot.id,
      phase,
      status: "RUNNING",
      homeTeamId: home.id,
      awayTeamId: away.id,
      refereeId,
      scoreHome,
      scoreAway,
    },
  });
  return { tournament, match, home, away };
}

const postPens = (matchId: string, home: number, away: number) =>
  app.inject({
    method: "POST",
    url: `/api/matches/${matchId}/penalties`,
    headers: authHeader(),
    payload: { home, away },
  });

describe("POST /matches/:id/penalties idempotency", () => {
  it("records the result and finishes the match on first send", async () => {
    const { match } = await seed();
    const res = await postPens(match.id, 4, 3);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "FINISHED", pensHome: 4, pensAway: 3 });
    const saved = await prisma.match.findUnique({ where: { id: match.id } });
    expect(saved).toMatchObject({ status: "FINISHED", pensHome: 4, pensAway: 3 });
  });

  it("reports success for a replay of the same result after the match is finished", async () => {
    const { match } = await seed();
    await postPens(match.id, 4, 3);

    // The referee's phone lost the response and replays from the outbox.
    const replay = await postPens(match.id, 4, 3);

    // MATCH_NOT_RUNNING here would drop the item and toast a lie: it landed.
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({
      status: "FINISHED",
      pensHome: 4,
      pensAway: 3,
      duplicate: true,
    });
    expect(await prisma.match.findUnique({ where: { id: match.id } })).toMatchObject({
      pensHome: 4,
      pensAway: 3,
    });
  });

  it("rejects a different result for an already-decided match", async () => {
    const { match } = await seed();
    await postPens(match.id, 4, 3);

    const res = await postPens(match.id, 5, 4);

    // Not a replay — a correction, which is the admin result editor's job.
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("PENALTIES_ALREADY_SET");
    expect(await prisma.match.findUnique({ where: { id: match.id } })).toMatchObject({
      pensHome: 4,
      pensAway: 3,
    });
  });

  it("still rejects penalties on a match that was never a draw", async () => {
    const { match } = await seed({ scoreHome: 2, scoreAway: 1 });
    const res = await postPens(match.id, 4, 3);

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("NOT_A_DRAW");
  });

  it("still rejects penalties on a group match", async () => {
    const { match } = await seed({ phase: "GROUP" });
    const res = await postPens(match.id, 4, 3);

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("NOT_KNOCKOUT");
  });

  it("rejects an equal penalty score", async () => {
    const { match } = await seed();
    const res = await postPens(match.id, 3, 3);

    expect(res.statusCode).toBe(400);
    expect(await prisma.match.findUnique({ where: { id: match.id } })).toMatchObject({
      status: "RUNNING",
      pensHome: null,
    });
  });
});
