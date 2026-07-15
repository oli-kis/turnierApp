import { prisma } from "../db/client.js";
import { maybeFinishSlot } from "./slotService.js";
import { resolveDependents } from "./sourceResolution.js";
import { broadcaster } from "../sse/broadcaster.js";

/**
 * Finalize a single running match: mark it FINISHED with the current score,
 * broadcast the downstream signals, resolve knockout dependents, and advance the
 * slot. Shared by the referee finish flow and the admin finish-running action so
 * both take the exact same downstream path.
 */
export async function finalizeMatch(
  matchId: string,
  tournamentId: string,
  slotId: string | null,
): Promise<void> {
  const match = await prisma.match.update({
    where: { id: matchId },
    data: { status: "FINISHED", finishedAt: new Date() },
  });
  broadcaster.broadcast(tournamentId, "match.finished", { matchId });
  broadcaster.broadcast(tournamentId, "standings.updated", { matchId });
  // Knockout matches feed their winner/loser into dependent bracket matches.
  if (match.phase !== "GROUP") await resolveDependents(match);
  if (slotId) await maybeFinishSlot(tournamentId, slotId);
}
