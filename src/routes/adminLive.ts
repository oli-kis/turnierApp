import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db/client.js";
import { Errors } from "../lib/errors.js";
import { requireAdmin } from "../plugins/auth.js";
import { getMatchOr404, getTournamentOr404 } from "../lib/loaders.js";
import { estimatedStartsBySlot } from "../lib/estimates.js";
import { maybeStartSlot } from "../services/slotService.js";
import { broadcaster } from "../sse/broadcaster.js";

const idParam = z.object({ id: z.string() });

interface SlotMatchView {
  matchId: string;
  pitch: string | null;
  referee: string | null;
  status: string;
  homeTeam: string | null;
  awayTeam: string | null;
  scoreHome: number;
  scoreAway: number;
}

async function slotView(tournamentId: string, slotIndex: number, est: Map<string, Date>) {
  const slot = await prisma.slot.findFirst({
    where: { tournamentId, index: slotIndex },
    include: {
      matches: {
        include: { pitch: true, referee: true, homeTeam: true, awayTeam: true },
        orderBy: { pitchId: "asc" },
      },
    },
  });
  if (!slot) return null;
  const matches: SlotMatchView[] = slot.matches.map((m) => ({
    matchId: m.id,
    pitch: m.pitch?.name ?? null,
    referee: m.referee?.name ?? null,
    status: m.status,
    homeTeam: m.homeTeam?.name ?? null,
    awayTeam: m.awayTeam?.name ?? null,
    scoreHome: m.scoreHome,
    scoreAway: m.scoreAway,
  }));
  return {
    slotId: slot.id,
    index: slot.index,
    status: slot.status,
    plannedStart: slot.plannedStart,
    actualStart: slot.actualStart,
    estimatedStart: est.get(slot.id) ?? null,
    matches,
  };
}

export async function adminLiveRoutes(app: FastifyInstance): Promise<void> {
  app.get("/tournaments/:id/dashboard", async (request) => {
    await requireAdmin(request);
    const { id } = idParam.parse(request.params);
    const tournament = await getTournamentOr404(id);
    const est = await estimatedStartsBySlot(id);

    const activeSlot = await prisma.slot.findFirst({
      where: { tournamentId: id, status: { in: ["WAITING_READY", "RUNNING"] } },
      orderBy: { index: "asc" },
    });

    const current = activeSlot ? await slotView(id, activeSlot.index, est) : null;
    const next = activeSlot ? await slotView(id, activeSlot.index + 1, est) : null;

    let delayMin: number | null = null;
    if (current) {
      const estStart = est.get(current.slotId);
      if (estStart) {
        delayMin = Math.round((estStart.getTime() - current.plannedStart.getTime()) / 60000);
      }
    }

    const unassigned = await prisma.match.findMany({
      where: {
        tournamentId: id,
        refereeId: null,
        slot: { status: { not: "FINISHED" } },
      },
      include: { slot: true, pitch: true, homeTeam: true, awayTeam: true },
      orderBy: [{ slot: { index: "asc" } }],
      take: 50,
    });

    return {
      tournamentStatus: tournament.status,
      currentSlot: current,
      nextSlot: next,
      delayMin,
      unassignedMatches: unassigned.map((m) => ({
        matchId: m.id,
        slotIndex: m.slot?.index ?? null,
        pitch: m.pitch?.name ?? null,
        homeTeam: m.homeTeam?.name ?? null,
        awayTeam: m.awayTeam?.name ?? null,
      })),
    };
  });

  // Override a missing referee: mark the match ready without one.
  app.post("/matches/:id/force-ready", async (request) => {
    await requireAdmin(request);
    const { id } = idParam.parse(request.params);
    const match = await getMatchOr404(id);
    if (!match.slotId) throw Errors.conflict("NO_SLOT", "Match is not in a slot");
    const slot = await prisma.slot.findUnique({ where: { id: match.slotId } });
    if (!slot || slot.status !== "WAITING_READY") {
      throw Errors.conflict("SLOT_NOT_WAITING", "Slot is not awaiting ready");
    }
    if (match.status !== "SCHEDULED") {
      throw Errors.conflict("INVALID_TRANSITION", "Match is not in SCHEDULED state");
    }

    await prisma.match.update({ where: { id }, data: { status: "READY" } });
    broadcaster.broadcast(match.tournamentId, "match.ready", { matchId: id, slotId: slot.id, forced: true });
    await maybeStartSlot(match.tournamentId, slot.id);
    return { status: "READY" };
  });

  // Post-hoc result correction (audit-logged).
  app.patch("/matches/:id/result", async (request) => {
    const admin = await requireAdmin(request);
    const { id } = idParam.parse(request.params);
    const body = z
      .object({
        scoreHome: z.number().int().nonnegative(),
        scoreAway: z.number().int().nonnegative(),
        pensHome: z.number().int().nonnegative().nullable().optional(),
        pensAway: z.number().int().nonnegative().nullable().optional(),
      })
      .parse(request.body);
    const match = await getMatchOr404(id);

    await prisma.$transaction(async (tx) => {
      await tx.match.update({
        where: { id },
        data: {
          scoreHome: body.scoreHome,
          scoreAway: body.scoreAway,
          ...(body.pensHome !== undefined ? { pensHome: body.pensHome } : {}),
          ...(body.pensAway !== undefined ? { pensAway: body.pensAway } : {}),
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: admin.userId,
          action: "MATCH_RESULT_CORRECTION",
          targetId: id,
          detail: JSON.stringify({
            from: { scoreHome: match.scoreHome, scoreAway: match.scoreAway },
            to: { scoreHome: body.scoreHome, scoreAway: body.scoreAway },
          }),
        },
      });
    });

    broadcaster.broadcast(match.tournamentId, "standings.updated", { matchId: id });
    return { status: "corrected" };
  });
}
