import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { prisma } from "../../src/db/client.js";

/**
 * Integration coverage for the admin lifecycle endpoints changed by
 * improvements.md items 2, 6, 7 and 9. Runs against the isolated
 * test-integration.db created in globalSetup; each test seeds its own data.
 */

let app: FastifyInstance;
let adminToken: string;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
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
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  // Wipe tournament-scoped data between tests (users are kept for the token).
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
});

const authHeader = () => ({ authorization: `Bearer ${adminToken}` });

interface SeedOpts {
  tournamentStatus?: "DRAFT" | "SCHEDULED" | "RUNNING" | "FINISHED";
  slotStatus?: "PENDING" | "WAITING_READY" | "RUNNING" | "FINISHED";
  matchStatus?: "SCHEDULED" | "READY" | "RUNNING" | "FINISHED";
  phase?: "GROUP" | "SEMIFINAL";
  scoreHome?: number;
  scoreAway?: number;
}

async function seed(opts: SeedOpts = {}) {
  const {
    tournamentStatus = "RUNNING",
    slotStatus = "RUNNING",
    matchStatus = "RUNNING",
    phase = "GROUP",
    scoreHome = 1,
    scoreAway = 0,
  } = opts;

  const tournament = await prisma.tournament.create({
    data: {
      name: "T",
      startAt: new Date(),
      matchDurationMin: 12,
      transitionMin: 3,
      pitchCount: 1,
      status: tournamentStatus,
    },
  });
  const category = await prisma.category.create({
    data: { tournamentId: tournament.id, name: "Cat" },
  });
  const group = await prisma.group.create({
    data: { categoryId: category.id, name: "A" },
  });
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
      actualStart: slotStatus === "RUNNING" ? new Date() : null,
      status: slotStatus,
    },
  });
  const match = await prisma.match.create({
    data: {
      tournamentId: tournament.id,
      categoryId: category.id,
      groupId: phase === "GROUP" ? group.id : null,
      slotId: slot.id,
      phase,
      status: matchStatus,
      homeTeamId: home.id,
      awayTeamId: away.id,
      scoreHome,
      scoreAway,
    },
  });
  return { tournament, category, group, home, away, slot, match };
}

/* --------------------------------------------------- Item 7: delete tournament */

describe("DELETE /tournaments/:id", () => {
  it("deletes a FINISHED tournament and cascades its matches", async () => {
    const { tournament, match } = await seed({
      tournamentStatus: "FINISHED",
      slotStatus: "FINISHED",
      matchStatus: "FINISHED",
    });
    const res = await app.inject({
      method: "DELETE",
      url: `/api/tournaments/${tournament.id}`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(204);
    expect(await prisma.tournament.findUnique({ where: { id: tournament.id } })).toBeNull();
    expect(await prisma.match.findUnique({ where: { id: match.id } })).toBeNull();
  });

  it("refuses to delete a RUNNING tournament", async () => {
    const { tournament } = await seed({ tournamentStatus: "RUNNING" });
    const res = await app.inject({
      method: "DELETE",
      url: `/api/tournaments/${tournament.id}`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("TOURNAMENT_RUNNING");
    expect(await prisma.tournament.findUnique({ where: { id: tournament.id } })).not.toBeNull();
  });

  it("removes tournament-scoped audit entries", async () => {
    const { tournament, match } = await seed({
      tournamentStatus: "FINISHED",
      slotStatus: "FINISHED",
      matchStatus: "FINISHED",
    });
    await prisma.auditLog.create({
      data: { actorId: "someone", action: "X", targetId: match.id },
    });
    await app.inject({
      method: "DELETE",
      url: `/api/tournaments/${tournament.id}`,
      headers: authHeader(),
    });
    expect(await prisma.auditLog.findMany({ where: { targetId: match.id } })).toHaveLength(0);
  });
});

/* --------------------------------------------- Item 9: finish tournament guard */

describe("POST /tournaments/:id/finish", () => {
  it("refuses to finish while a match is RUNNING and reports the ids", async () => {
    const { tournament, match } = await seed({ matchStatus: "RUNNING" });
    const res = await app.inject({
      method: "POST",
      url: `/api/tournaments/${tournament.id}/finish`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.error.code).toBe("MATCHES_STILL_RUNNING");
    expect(body.error.details.matchIds).toContain(match.id);
    expect((await prisma.tournament.findUnique({ where: { id: tournament.id } }))!.status).toBe(
      "RUNNING",
    );
  });

  it("finishes when no match is live", async () => {
    const { tournament } = await seed({
      slotStatus: "FINISHED",
      matchStatus: "FINISHED",
    });
    const res = await app.inject({
      method: "POST",
      url: `/api/tournaments/${tournament.id}/finish`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    expect((await prisma.tournament.findUnique({ where: { id: tournament.id } }))!.status).toBe(
      "FINISHED",
    );
  });
});

/* ------------------------------------------- Item 2: finish all running matches */

describe("POST /tournaments/:id/matches/finish-running", () => {
  it("finishes a running group match at its current score", async () => {
    const { tournament, match } = await seed({ matchStatus: "RUNNING", scoreHome: 2, scoreAway: 1 });
    const res = await app.inject({
      method: "POST",
      url: `/api/tournaments/${tournament.id}/matches/finish-running`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.finished).toContain(match.id);
    expect(body.skipped).toHaveLength(0);
    const after = await prisma.match.findUnique({ where: { id: match.id } });
    expect(after!.status).toBe("FINISHED");
    expect(after!.finishedAt).not.toBeNull();
  });

  it("skips a level knockout draw as PENALTIES_REQUIRED", async () => {
    const { tournament, match } = await seed({
      phase: "SEMIFINAL",
      matchStatus: "RUNNING",
      scoreHome: 1,
      scoreAway: 1,
    });
    const res = await app.inject({
      method: "POST",
      url: `/api/tournaments/${tournament.id}/matches/finish-running`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.finished).toHaveLength(0);
    expect(body.skipped).toEqual([{ matchId: match.id, reason: "PENALTIES_REQUIRED" }]);
    expect((await prisma.match.findUnique({ where: { id: match.id } }))!.status).toBe("RUNNING");
  });

  it("writes an audit entry", async () => {
    const { tournament } = await seed({ matchStatus: "RUNNING" });
    await app.inject({
      method: "POST",
      url: `/api/tournaments/${tournament.id}/matches/finish-running`,
      headers: authHeader(),
    });
    const logs = await prisma.auditLog.findMany({ where: { action: "MATCHES_FINISH_RUNNING" } });
    expect(logs).toHaveLength(1);
  });
});

/* ------------------------------------------------- Item 6: delete referee */

describe("DELETE /admin/referees/:id", () => {
  async function makeReferee() {
    return prisma.user.create({
      data: {
        email: `ref-${Date.now()}-${Math.random()}@test.ch`,
        name: "Ref",
        passwordHash: "x",
        role: "REFEREE",
        status: "APPROVED",
      },
    });
  }

  it("blocks deletion while assigned to a non-finished match", async () => {
    const ref = await makeReferee();
    const { match } = await seed({ matchStatus: "RUNNING" });
    await prisma.match.update({ where: { id: match.id }, data: { refereeId: ref.id } });

    const res = await app.inject({
      method: "DELETE",
      url: `/api/admin/referees/${ref.id}`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.error.code).toBe("REFEREE_HAS_ASSIGNMENTS");
    expect(body.error.details.matchIds).toContain(match.id);
    expect(await prisma.user.findUnique({ where: { id: ref.id } })).not.toBeNull();
  });

  it("deletes when only finished matches reference them and nulls the history link", async () => {
    const ref = await makeReferee();
    const { match } = await seed({ matchStatus: "FINISHED", slotStatus: "FINISHED" });
    await prisma.match.update({ where: { id: match.id }, data: { refereeId: ref.id } });

    const res = await app.inject({
      method: "DELETE",
      url: `/api/admin/referees/${ref.id}`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(204);
    expect(await prisma.user.findUnique({ where: { id: ref.id } })).toBeNull();
    const after = await prisma.match.findUnique({ where: { id: match.id } });
    expect(after).not.toBeNull();
    expect(after!.refereeId).toBeNull();
  });
});
