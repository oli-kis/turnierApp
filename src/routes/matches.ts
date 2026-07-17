import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db/client.js";
import { Errors } from "../lib/errors.js";
import { requireAdmin } from "../plugins/auth.js";
import { getMatchOr404 } from "../lib/loaders.js";
import { estimatedStartsBySlot } from "../lib/estimates.js";
import { maybeStartSlot } from "../services/slotService.js";
import { notifyRefereeAssigned } from "../services/pushService.js";
import { broadcaster } from "../sse/broadcaster.js";

const idParam = z.object({ id: z.string() });

const listQuery = z.object({
  categoryId: z.string().optional(),
  groupId: z.string().optional(),
  phase: z
    .enum(["GROUP", "ROUND_OF_16", "QUARTERFINAL", "SEMIFINAL", "THIRD_PLACE", "FINAL"])
    .optional(),
  teamId: z.string().optional(),
  status: z.enum(["SCHEDULED", "READY", "RUNNING", "FINISHED"]).optional(),
});

export async function matchRoutes(app: FastifyInstance): Promise<void> {
  // Filterable public match list.
  app.get("/tournaments/:id/matches", async (request) => {
    const { id } = idParam.parse(request.params);
    const q = listQuery.parse(request.query);
    const matches = await prisma.match.findMany({
      where: {
        tournamentId: id,
        ...(q.categoryId ? { categoryId: q.categoryId } : {}),
        ...(q.groupId ? { groupId: q.groupId } : {}),
        ...(q.phase ? { phase: q.phase } : {}),
        ...(q.status ? { status: q.status } : {}),
        ...(q.teamId
          ? { OR: [{ homeTeamId: q.teamId }, { awayTeamId: q.teamId }] }
          : {}),
      },
      include: { slot: true, pitch: true, homeTeam: true, awayTeam: true },
      orderBy: [{ slot: { index: "asc" } }, { pitchId: "asc" }],
    });
    // Attach each match's estimated kickoff (computed, never persisted) so every
    // match rendering can show the time. slot carries plannedStart already.
    const est = await estimatedStartsBySlot(id);
    return {
      matches: matches.map((m) => ({
        ...m,
        estimatedStart: m.slotId ? est.get(m.slotId) ?? null : null,
      })),
    };
  });

  // Public match detail incl. goals.
  app.get("/matches/:id", async (request) => {
    const { id } = idParam.parse(request.params);
    const match = await prisma.match.findUnique({
      where: { id },
      include: {
        slot: true,
        pitch: true,
        homeTeam: true,
        awayTeam: true,
        referee: { select: { id: true, name: true } },
        goals: { orderBy: { createdAt: "asc" } },
      },
    });
    if (!match) throw Errors.notFound("Match");
    return { match };
  });

  // Admin manual fixes: pitch / slot / referee.
  app.patch("/matches/:id", async (request) => {
    await requireAdmin(request);
    const { id } = idParam.parse(request.params);
    const body = z
      .object({
        pitchId: z.string().nullable().optional(),
        slotId: z.string().nullable().optional(),
        refereeId: z.string().nullable().optional(),
      })
      .refine((v) => Object.keys(v).length > 0, { message: "No fields to update" })
      .parse(request.body);
    const match = await getMatchOr404(id);

    // Target slot for conflict checks: new value if provided, else current.
    const targetSlotId =
      body.slotId !== undefined ? body.slotId : match.slotId;

    if (body.pitchId != null) {
      const pitch = await prisma.pitch.findUnique({ where: { id: body.pitchId } });
      if (!pitch || pitch.tournamentId !== match.tournamentId) {
        throw Errors.badRequest("Pitch must belong to the same tournament");
      }
    }

    if (body.slotId != null) {
      const slot = await prisma.slot.findUnique({ where: { id: body.slotId } });
      if (!slot || slot.tournamentId !== match.tournamentId) {
        throw Errors.badRequest("Slot must belong to the same tournament");
      }
    }

    if (body.refereeId != null) {
      const ref = await prisma.user.findUnique({ where: { id: body.refereeId } });
      if (!ref || ref.role !== "REFEREE" || ref.status !== "APPROVED") {
        throw Errors.badRequest("Referee must be an APPROVED referee");
      }
      // A referee may hold at most one match per slot.
      if (targetSlotId) {
        const clash = await prisma.match.findFirst({
          where: {
            slotId: targetSlotId,
            refereeId: body.refereeId,
            id: { not: id },
          },
        });
        if (clash) {
          throw Errors.conflict(
            "REFEREE_SLOT_CONFLICT",
            "Referee already has a match in that slot",
          );
        }
      }
    }

    const updated = await prisma.match.update({
      where: { id },
      data: {
        ...(body.pitchId !== undefined ? { pitchId: body.pitchId } : {}),
        ...(body.slotId !== undefined ? { slotId: body.slotId } : {}),
        ...(body.refereeId !== undefined ? { refereeId: body.refereeId } : {}),
      },
    });

    broadcaster.broadcast(match.tournamentId, "schedule.updated", { matchId: id });
    // Notify only a referee who is newly on this match. Re-saving the same
    // assignment, or moving the pitch of a match they already know about, is not
    // news — and a phone that buzzes for non-news gets its notifications turned
    // off before the tournament starts.
    if (body.refereeId != null && body.refereeId !== match.refereeId) {
      notifyRefereeAssigned(id, body.refereeId);
    }
    // Removing a match from a slot may let that slot fire without it.
    if (body.slotId === null && match.slotId) {
      await maybeStartSlot(match.tournamentId, match.slotId);
    }
    return { match: updated };
  });
}
