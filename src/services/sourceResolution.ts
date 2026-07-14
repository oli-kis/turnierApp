import type { Match } from "@prisma/client";
import { prisma } from "../db/client.js";
import { broadcaster } from "../sse/broadcaster.js";

/** Winner / loser team ids of a finished knockout match (penalties break draws). */
export function decideOutcome(match: Match): { winner: string | null; loser: string | null } {
  if (!match.homeTeamId || !match.awayTeamId) return { winner: null, loser: null };
  let homeWins: boolean;
  if (match.scoreHome !== match.scoreAway) {
    homeWins = match.scoreHome > match.scoreAway;
  } else {
    homeWins = (match.pensHome ?? 0) > (match.pensAway ?? 0);
  }
  return homeWins
    ? { winner: match.homeTeamId, loser: match.awayTeamId }
    : { winner: match.awayTeamId, loser: match.homeTeamId };
}

interface StoredSource {
  type: "GROUP_RANK" | "MATCH_WINNER" | "MATCH_LOSER";
  matchId?: string;
  groupId?: string;
  rank?: number;
}

/**
 * After a knockout match finishes, fill the resolved team into any match that
 * sources from it (MATCH_WINNER / MATCH_LOSER), then broadcast bracket.updated.
 */
export async function resolveDependents(match: Match): Promise<void> {
  const { winner, loser } = decideOutcome(match);
  if (!winner || !loser) return;

  const dependents = await prisma.match.findMany({
    where: {
      tournamentId: match.tournamentId,
      OR: [{ homeSource: { contains: match.id } }, { awaySource: { contains: match.id } }],
    },
  });

  let changed = false;
  for (const dep of dependents) {
    const data: { homeTeamId?: string; awayTeamId?: string } = {};

    const home = parseSource(dep.homeSource);
    if (home?.matchId === match.id && !dep.homeTeamId) {
      data.homeTeamId = home.type === "MATCH_LOSER" ? loser : winner;
    }
    const away = parseSource(dep.awaySource);
    if (away?.matchId === match.id && !dep.awayTeamId) {
      data.awayTeamId = away.type === "MATCH_LOSER" ? loser : winner;
    }

    if (Object.keys(data).length > 0) {
      await prisma.match.update({ where: { id: dep.id }, data });
      changed = true;
    }
  }

  if (changed) {
    broadcaster.broadcast(match.tournamentId, "bracket.updated", { matchId: match.id });
  }
}

function parseSource(raw: string | null): StoredSource | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredSource;
  } catch {
    return null;
  }
}
