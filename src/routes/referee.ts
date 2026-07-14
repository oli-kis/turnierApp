import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db/client.js";
import { Errors } from "../lib/errors.js";
import { requireApprovedReferee } from "../plugins/auth.js";
import { requireAssignedReferee } from "../lib/matchAuth.js";
import { getMatchOr404 } from "../lib/loaders.js";
import { estimatedStartsBySlot } from "../lib/estimates.js";
import { maybeStartSlot } from "../services/slotService.js";
import { broadcaster } from "../sse/broadcaster.js";

const idParam = z.object({ id: z.string() });

export async function refereeRoutes(app: FastifyInstance): Promise<void> {
  // Own assignments with slot state and estimated start.
  app.get("/referees/me/matches", async (request) => {
    const user = await requireApprovedReferee(request);
    const matches = await prisma.match.findMany({
      where: { refereeId: user.userId },
      include: { slot: true, pitch: true, homeTeam: true, awayTeam: true },
      orderBy: [{ slot: { index: "asc" } }],
    });

    // Group by tournament to compute estimates once per tournament.
    const estCache = new Map<string, Map<string, Date>>();
    const result = [];
    for (const m of matches) {
      if (!estCache.has(m.tournamentId)) {
        estCache.set(m.tournamentId, await estimatedStartsBySlot(m.tournamentId));
      }
      const est = m.slotId ? estCache.get(m.tournamentId)!.get(m.slotId) ?? null : null;
      result.push({
        id: m.id,
        status: m.status,
        phase: m.phase,
        pitch: m.pitch?.name ?? null,
        slotIndex: m.slot?.index ?? null,
        slotStatus: m.slot?.status ?? null,
        estimatedStart: est,
        homeTeam: m.homeTeam?.name ?? null,
        awayTeam: m.awayTeam?.name ?? null,
        scoreHome: m.scoreHome,
        scoreAway: m.scoreAway,
      });
    }
    return { matches: result };
  });

  // Mark ready — only the assigned referee, only while the slot is WAITING_READY.
  app.post("/matches/:id/ready", async (request) => {
    const { id } = idParam.parse(request.params);
    const match = await getMatchOr404(id);
    await requireAssignedReferee(request, match);

    if (!match.slotId) throw Errors.conflict("NO_SLOT", "Match is not in a slot");
    const slot = await prisma.slot.findUnique({ where: { id: match.slotId } });
    if (!slot || slot.status !== "WAITING_READY") {
      throw Errors.conflict("SLOT_NOT_WAITING", "Slot is not awaiting ready");
    }
    if (match.status !== "SCHEDULED") {
      throw Errors.conflict("INVALID_TRANSITION", "Match is not in SCHEDULED state");
    }

    await prisma.match.update({ where: { id }, data: { status: "READY" } });
    broadcaster.broadcast(match.tournamentId, "match.ready", { matchId: id, slotId: slot.id });
    await maybeStartSlot(match.tournamentId, slot.id);
    return { status: "READY" };
  });

  // Undo ready before the slot fires.
  app.post("/matches/:id/unready", async (request) => {
    const { id } = idParam.parse(request.params);
    const match = await getMatchOr404(id);
    await requireAssignedReferee(request, match);

    if (!match.slotId) throw Errors.conflict("NO_SLOT", "Match is not in a slot");
    const slot = await prisma.slot.findUnique({ where: { id: match.slotId } });
    if (!slot || slot.status !== "WAITING_READY") {
      throw Errors.conflict("SLOT_ALREADY_STARTED", "Slot already started");
    }
    if (match.status !== "READY") {
      throw Errors.conflict("INVALID_TRANSITION", "Match is not READY");
    }

    await prisma.match.update({ where: { id }, data: { status: "SCHEDULED" } });
    broadcaster.broadcast(match.tournamentId, "match.unready", { matchId: id, slotId: slot.id });
    return { status: "SCHEDULED" };
  });
}
