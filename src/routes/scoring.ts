import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db/client.js";
import { Errors } from "../lib/errors.js";
import { requireAssignedReferee, requireAssignedRefereeOrAdmin } from "../lib/matchAuth.js";
import { getMatchOr404 } from "../lib/loaders.js";
import { finalizeMatch } from "../services/matchFinalize.js";
import { broadcaster } from "../sse/broadcaster.js";

const idParam = z.object({ id: z.string() });

export async function scoringRoutes(app: FastifyInstance): Promise<void> {
  // Add a goal — assigned referee only, match must be RUNNING.
  app.post("/matches/:id/goals", async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const { teamId } = z.object({ teamId: z.string() }).parse(request.body);
    const match = await getMatchOr404(id);
    await requireAssignedReferee(request, match);

    if (match.status !== "RUNNING") {
      throw Errors.conflict("MATCH_NOT_RUNNING", "Goals can only be added to a running match");
    }
    if (teamId !== match.homeTeamId && teamId !== match.awayTeamId) {
      throw Errors.badRequest("teamId must be one of the two teams in this match");
    }

    const isHome = teamId === match.homeTeamId;
    const referee = request.user.userId;
    const goal = await prisma.$transaction(async (tx) => {
      const g = await tx.goal.create({ data: { matchId: id, teamId, createdBy: referee } });
      await tx.match.update({
        where: { id },
        data: isHome ? { scoreHome: { increment: 1 } } : { scoreAway: { increment: 1 } },
      });
      return g;
    });

    broadcaster.broadcast(match.tournamentId, "goal.scored", { matchId: id, teamId, goalId: goal.id });
    return reply.status(201).send({ goalId: goal.id });
  });

  // Delete a goal — the assigned referee or an admin.
  app.delete("/goals/:id", async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const goal = await prisma.goal.findUnique({ where: { id }, include: { match: true } });
    if (!goal) throw Errors.notFound("Goal");
    await requireAssignedRefereeOrAdmin(request, goal.match);

    const isHome = goal.teamId === goal.match.homeTeamId;
    await prisma.$transaction(async (tx) => {
      await tx.goal.delete({ where: { id } });
      await tx.match.update({
        where: { id: goal.matchId },
        data: isHome ? { scoreHome: { decrement: 1 } } : { scoreAway: { decrement: 1 } },
      });
    });

    broadcaster.broadcast(goal.match.tournamentId, "goal.deleted", {
      matchId: goal.matchId,
      goalId: id,
    });
    return reply.status(204).send();
  });

  // Finish — assigned referee or admin. Knockout draw requires penalties.
  app.post("/matches/:id/finish", async (request) => {
    const { id } = idParam.parse(request.params);
    const match = await getMatchOr404(id);
    await requireAssignedRefereeOrAdmin(request, match);

    if (match.status !== "RUNNING") {
      throw Errors.conflict("MATCH_NOT_RUNNING", "Only a running match can be finished");
    }

    const isKnockout = match.phase !== "GROUP";
    const drawn = match.scoreHome === match.scoreAway;
    const pensSet = match.pensHome !== null && match.pensAway !== null;
    if (isKnockout && drawn && !pensSet) {
      throw Errors.conflict("PENALTIES_REQUIRED", "Knockout draw needs a penalty result");
    }

    await finalizeMatch(id, match.tournamentId, match.slotId);
    return { status: "FINISHED" };
  });

  // Submit penalties for a drawn knockout match, then auto-finish.
  app.post("/matches/:id/penalties", async (request) => {
    const { id } = idParam.parse(request.params);
    const body = z
      .object({ home: z.number().int().nonnegative(), away: z.number().int().nonnegative() })
      .refine((v) => v.home !== v.away, { message: "Penalty scores must differ" })
      .parse(request.body);
    const match = await getMatchOr404(id);
    await requireAssignedRefereeOrAdmin(request, match);

    if (match.phase === "GROUP") {
      throw Errors.conflict("NOT_KNOCKOUT", "Penalties only apply to knockout matches");
    }
    if (match.status !== "RUNNING") {
      throw Errors.conflict("MATCH_NOT_RUNNING", "Match is not running");
    }
    if (match.scoreHome !== match.scoreAway) {
      throw Errors.conflict("NOT_A_DRAW", "Penalties only apply after a draw");
    }

    await prisma.match.update({
      where: { id },
      data: { pensHome: body.home, pensAway: body.away },
    });
    await finalizeMatch(id, match.tournamentId, match.slotId);
    return { status: "FINISHED", pensHome: body.home, pensAway: body.away };
  });
}
