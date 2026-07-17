import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db/client.js";
import { Errors } from "../lib/errors.js";
import { requireAssignedReferee, requireAssignedRefereeOrAdmin } from "../lib/matchAuth.js";
import { getMatchOr404 } from "../lib/loaders.js";
import { finalizeMatch } from "../services/matchFinalize.js";
import { broadcaster } from "../sse/broadcaster.js";

const idParam = z.object({ id: z.string() });

/** Prisma's unique-constraint violation (P2002), without importing the error class. */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002";
}

export async function scoringRoutes(app: FastifyInstance): Promise<void> {
  // Add a goal — assigned referee only, match must be RUNNING.
  app.post("/matches/:id/goals", async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const { teamId, clientId } = z
      .object({ teamId: z.string(), clientId: z.string().min(1).max(64).optional() })
      .parse(request.body);
    const match = await getMatchOr404(id);
    await requireAssignedReferee(request, match);

    // Idempotency first: a referee's phone replays its offline outbox after a
    // dropped connection, and the request it retries may well have succeeded.
    // This runs before the RUNNING check on purpose — by replay time the match
    // is often already finished, and a goal that IS recorded must report success
    // rather than a confusing MATCH_NOT_RUNNING.
    if (clientId) {
      const existing = await prisma.goal.findUnique({ where: { clientId } });
      if (existing) {
        if (existing.matchId !== id) {
          throw Errors.badRequest("clientId already used for a different match");
        }
        return reply.status(200).send({ goalId: existing.id, duplicate: true });
      }
    }

    if (match.status !== "RUNNING") {
      throw Errors.conflict("MATCH_NOT_RUNNING", "Goals can only be added to a running match");
    }
    if (teamId !== match.homeTeamId && teamId !== match.awayTeamId) {
      throw Errors.badRequest("teamId must be one of the two teams in this match");
    }

    const isHome = teamId === match.homeTeamId;
    const referee = request.user.userId;
    let goal;
    try {
      goal = await prisma.$transaction(async (tx) => {
        const g = await tx.goal.create({ data: { matchId: id, teamId, createdBy: referee, clientId } });
        await tx.match.update({
          where: { id },
          data: isHome ? { scoreHome: { increment: 1 } } : { scoreAway: { increment: 1 } },
        });
        return g;
      });
    } catch (err) {
      // Two replays of the same tap racing each other: the unique index makes
      // one lose. The transaction rolled back, so the score was not double
      // counted — report the winner's goal.
      if (clientId && isUniqueViolation(err)) {
        const winner = await prisma.goal.findUnique({ where: { clientId } });
        if (winner) return reply.status(200).send({ goalId: winner.id, duplicate: true });
      }
      throw err;
    }

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

    // Idempotency before the RUNNING check, for the same reason as goals: the
    // referee's outbox replays this after a dropped connection, and the request
    // it retries may well have succeeded — in which case the match it is asking
    // about is already FINISHED. The submitted result IS the recorded result, so
    // report success rather than a MATCH_NOT_RUNNING the referee cannot act on.
    // Penalties need no clientId to do this: unlike a goal, the result is not a
    // countable event but a value, so an identical resubmission is a no-op by
    // definition and the values themselves identify the replay.
    if (match.status === "FINISHED" && match.pensHome !== null && match.pensAway !== null) {
      if (match.pensHome === body.home && match.pensAway === body.away) {
        return {
          status: "FINISHED",
          pensHome: match.pensHome,
          pensAway: match.pensAway,
          duplicate: true,
        };
      }
      // A *different* result for a match already decided is not a replay — it is
      // a correction, and correcting a finished match is the admin result editor's
      // job (it rewrites the bracket behind a typed confirmation).
      throw Errors.conflict(
        "PENALTIES_ALREADY_SET",
        `Match already finished with penalties ${match.pensHome}:${match.pensAway}`,
      );
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
