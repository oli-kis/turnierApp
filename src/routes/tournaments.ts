import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db/client.js";
import { Errors } from "../lib/errors.js";
import { requireAdmin } from "../plugins/auth.js";
import { getTournamentOr404, scheduleExists } from "../lib/loaders.js";
import { finalizeMatch } from "../services/matchFinalize.js";
import { broadcaster } from "../sse/broadcaster.js";

const createSchema = z.object({
  name: z.string().min(1),
  startAt: z.coerce.date(),
  matchDurationMin: z.number().int().positive(),
  transitionMin: z.number().int().nonnegative(),
  pitchCount: z.number().int().positive(),
});

const patchSchema = z
  .object({
    name: z.string().min(1).optional(),
    startAt: z.coerce.date().optional(),
    matchDurationMin: z.number().int().positive().optional(),
    transitionMin: z.number().int().nonnegative().optional(),
    pitchCount: z.number().int().positive().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "No fields to update" });

const idParam = z.object({ id: z.string() });

export async function tournamentRoutes(app: FastifyInstance): Promise<void> {
  app.post("/tournaments", async (request, reply) => {
    await requireAdmin(request);
    const data = createSchema.parse(request.body);
    const tournament = await prisma.tournament.create({
      data: {
        name: data.name,
        startAt: data.startAt,
        matchDurationMin: data.matchDurationMin,
        transitionMin: data.transitionMin,
        pitchCount: data.pitchCount,
        status: "DRAFT",
        pitches: {
          create: Array.from({ length: data.pitchCount }, (_, i) => ({
            name: `Platz ${i + 1}`,
            sortOrder: i,
          })),
        },
      },
      include: { pitches: true },
    });
    return reply.status(201).send({ tournament });
  });

  app.get("/tournaments", async () => {
    const tournaments = await prisma.tournament.findMany({
      orderBy: { startAt: "asc" },
    });
    return { tournaments };
  });

  app.get("/tournaments/:id", async (request) => {
    const { id } = idParam.parse(request.params);
    const tournament = await prisma.tournament.findUnique({
      where: { id },
      include: {
        pitches: { orderBy: { sortOrder: "asc" } },
        categories: {
          include: {
            groups: { include: { teams: true } },
            teams: true,
          },
        },
      },
    });
    if (!tournament) throw Errors.notFound("Tournament");
    return { tournament };
  });

  app.patch("/tournaments/:id", async (request) => {
    await requireAdmin(request);
    const { id } = idParam.parse(request.params);
    const patch = patchSchema.parse(request.body);
    const tournament = await getTournamentOr404(id);

    if (tournament.status !== "DRAFT" && tournament.status !== "SCHEDULED") {
      throw Errors.conflict(
        "TOURNAMENT_LOCKED",
        "Tournament can only be edited while DRAFT or SCHEDULED",
      );
    }

    // Timing / pitch changes invalidate an existing schedule.
    const timingChanged =
      patch.matchDurationMin !== undefined ||
      patch.transitionMin !== undefined ||
      patch.pitchCount !== undefined ||
      patch.startAt !== undefined;
    if (timingChanged && (await scheduleExists(id))) {
      throw Errors.conflict(
        "SCHEDULE_EXISTS",
        "Changing timing or pitch count requires regenerating the schedule first",
      );
    }

    const updated = await prisma.tournament.update({ where: { id }, data: patch });
    return { tournament: updated };
  });

  app.delete("/tournaments/:id", async (request, reply) => {
    await requireAdmin(request);
    const { id } = idParam.parse(request.params);
    const tournament = await getTournamentOr404(id);
    // Deletable in DRAFT, SCHEDULED and FINISHED; never while RUNNING.
    if (tournament.status === "RUNNING") {
      throw Errors.conflict("TOURNAMENT_RUNNING", "A running tournament cannot be deleted");
    }

    // Categories/pitches/slots/matches/goals cascade via schema FKs. AuditLog has
    // no FK (targetId is a free string), so remove its tournament-scoped rows here.
    const matchIds = (
      await prisma.match.findMany({ where: { tournamentId: id }, select: { id: true } })
    ).map((m) => m.id);

    await prisma.$transaction([
      prisma.auditLog.deleteMany({ where: { targetId: { in: [id, ...matchIds] } } }),
      prisma.tournament.delete({ where: { id } }),
    ]);
    return reply.status(204).send();
  });

  app.post("/tournaments/:id/start", async (request) => {
    await requireAdmin(request);
    const { id } = idParam.parse(request.params);
    const tournament = await getTournamentOr404(id);
    if (tournament.status !== "SCHEDULED") {
      throw Errors.conflict(
        "INVALID_TRANSITION",
        "Tournament must be SCHEDULED to start",
      );
    }
    const firstSlot = await prisma.slot.findFirst({
      where: { tournamentId: id },
      orderBy: { index: "asc" },
    });
    if (!firstSlot) throw Errors.conflict("NO_SCHEDULE", "No slots to start");

    await prisma.$transaction([
      prisma.tournament.update({ where: { id }, data: { status: "RUNNING" } }),
      prisma.slot.update({
        where: { id: firstSlot.id },
        data: { status: "WAITING_READY" },
      }),
    ]);

    broadcaster.broadcast(id, "slot.waiting-ready", { slotId: firstSlot.id, index: firstSlot.index });
    return { status: "RUNNING", waitingSlotId: firstSlot.id };
  });

  app.post("/tournaments/:id/finish", async (request) => {
    await requireAdmin(request);
    const { id } = idParam.parse(request.params);
    const tournament = await getTournamentOr404(id);
    if (tournament.status !== "RUNNING") {
      throw Errors.conflict("INVALID_TRANSITION", "Tournament must be RUNNING to finish");
    }

    // A finished tournament must never contain a live match. Refuse while any
    // match is READY or RUNNING; the admin finishes those first (finish-running).
    const live = await prisma.match.findMany({
      where: { tournamentId: id, status: { in: ["READY", "RUNNING"] } },
      select: { id: true },
    });
    if (live.length > 0) {
      const matchIds = live.map((m) => m.id);
      throw Errors.conflict(
        "MATCHES_STILL_RUNNING",
        `Es laufen noch ${matchIds.length} Spiele — zuerst beenden`,
        { matchIds },
      );
    }

    const updated = await prisma.tournament.update({
      where: { id },
      data: { status: "FINISHED" },
    });
    return { tournament: updated };
  });

  // Force-finish every RUNNING match at its current score. Knockout draws with no
  // penalty result cannot pick a winner and are skipped for individual resolution.
  app.post("/tournaments/:id/matches/finish-running", async (request) => {
    const admin = await requireAdmin(request);
    const { id } = idParam.parse(request.params);
    await getTournamentOr404(id);

    const running = await prisma.match.findMany({
      where: { tournamentId: id, status: "RUNNING" },
      orderBy: [{ slot: { index: "asc" } }],
    });

    const finished: string[] = [];
    const skipped: { matchId: string; reason: string }[] = [];

    for (const match of running) {
      const isKnockout = match.phase !== "GROUP";
      const drawn = match.scoreHome === match.scoreAway;
      const pensSet = match.pensHome !== null && match.pensAway !== null;
      if (isKnockout && drawn && !pensSet) {
        skipped.push({ matchId: match.id, reason: "PENALTIES_REQUIRED" });
        continue;
      }
      await finalizeMatch(match.id, match.tournamentId, match.slotId);
      finished.push(match.id);
    }

    if (finished.length > 0 || skipped.length > 0) {
      await prisma.auditLog.create({
        data: {
          actorId: admin.userId,
          action: "MATCHES_FINISH_RUNNING",
          targetId: id,
          detail: JSON.stringify({ finished, skipped }),
        },
      });
    }

    return { finished, skipped };
  });
}
