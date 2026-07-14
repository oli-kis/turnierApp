import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db/client.js";
import { Errors } from "../lib/errors.js";
import { requireAdmin } from "../plugins/auth.js";
import { getTournamentOr404, scheduleExists } from "../lib/loaders.js";
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
    if (tournament.status !== "DRAFT") {
      throw Errors.conflict("TOURNAMENT_NOT_DRAFT", "Only DRAFT tournaments can be deleted");
    }
    await prisma.tournament.delete({ where: { id } });
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
    const updated = await prisma.tournament.update({
      where: { id },
      data: { status: "FINISHED" },
    });
    return { tournament: updated };
  });
}
