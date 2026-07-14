import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db/client.js";
import { Errors } from "../lib/errors.js";
import { requireAdmin } from "../plugins/auth.js";
import { getCategoryOr404 } from "../lib/loaders.js";
import { generateKnockout } from "../services/knockoutService.js";
import { broadcaster } from "../sse/broadcaster.js";

const idParam = z.object({ id: z.string() });

const PHASE_ORDER = ["ROUND_OF_16", "QUARTERFINAL", "SEMIFINAL", "THIRD_PLACE", "FINAL"] as const;
const PHASE_ABBREV: Record<string, string> = {
  ROUND_OF_16: "R16",
  QUARTERFINAL: "QF",
  SEMIFINAL: "SF",
  THIRD_PLACE: "3rd",
  FINAL: "Final",
};

interface StoredSource {
  type: "GROUP_RANK" | "MATCH_WINNER" | "MATCH_LOSER";
  matchId?: string;
  groupId?: string;
  rank?: number;
}

function parseSource(raw: string | null): StoredSource | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredSource;
  } catch {
    return null;
  }
}

export async function knockoutRoutes(app: FastifyInstance): Promise<void> {
  // Generate the knockout bracket.
  app.post("/categories/:id/knockout/generate", async (request) => {
    await requireAdmin(request);
    const { id } = idParam.parse(request.params);
    const result = await generateKnockout(id);
    return result;
  });

  // Public knockout tree with readable, possibly-unresolved slots.
  app.get("/categories/:id/bracket", async (request) => {
    const { id } = idParam.parse(request.params);
    const category = await prisma.category.findUnique({
      where: { id },
      include: { groups: true },
    });
    if (!category) throw Errors.notFound("Category");

    const matches = await prisma.match.findMany({
      where: { categoryId: id, phase: { not: "GROUP" } },
      include: { homeTeam: true, awayTeam: true, slot: true, pitch: true },
      orderBy: [{ slot: { index: "asc" } }],
    });

    const groupName = new Map(category.groups.map((g) => [g.id, g.name]));
    // Short label per knockout match for winner/loser references.
    const matchLabel = new Map<string, string>();
    for (const m of matches) {
      matchLabel.set(m.id, `${PHASE_ABBREV[m.phase] ?? m.phase}${(m.bracketSlot ?? 0) + 1}`);
    }

    const describe = (teamName: string | null, raw: string | null): string => {
      if (teamName) return teamName;
      const src = parseSource(raw);
      if (!src) return "TBD";
      if (src.type === "GROUP_RANK") {
        return `${src.rank}. ${groupName.get(src.groupId ?? "") ?? "Gruppe"}`;
      }
      const ref = src.matchId ? matchLabel.get(src.matchId) ?? "?" : "?";
      return src.type === "MATCH_LOSER" ? `Verlierer ${ref}` : `Sieger ${ref}`;
    };

    const view = matches.map((m) => ({
      id: m.id,
      phase: m.phase,
      label: matchLabel.get(m.id),
      slotIndex: m.slot?.index ?? null,
      pitch: m.pitch?.name ?? null,
      status: m.status,
      home: describe(m.homeTeam?.name ?? null, m.homeSource),
      away: describe(m.awayTeam?.name ?? null, m.awaySource),
      homeTeamId: m.homeTeamId,
      awayTeamId: m.awayTeamId,
      scoreHome: m.scoreHome,
      scoreAway: m.scoreAway,
      pensHome: m.pensHome,
      pensAway: m.pensAway,
    }));

    // Group by phase in bracket order.
    const rounds = PHASE_ORDER.filter((p) => view.some((m) => m.phase === p)).map((phase) => ({
      phase,
      matches: view.filter((m) => m.phase === phase),
    }));

    return { categoryId: id, generated: category.knockoutGenerated, rounds };
  });

  // Manual tie resolution by drawing of lots.
  app.patch("/groups/:id/tiebreak", async (request) => {
    await requireAdmin(request);
    const { id } = idParam.parse(request.params);
    const { order } = z.object({ order: z.array(z.string()).min(1) }).parse(request.body);

    const group = await prisma.group.findUnique({ where: { id }, include: { teams: true } });
    if (!group) throw Errors.notFound("Group");

    const teamIds = new Set(group.teams.map((t) => t.id));
    const orderSet = new Set(order);
    const sameSize = orderSet.size === teamIds.size && order.length === teamIds.size;
    const sameMembers = order.every((tid) => teamIds.has(tid));
    if (!sameSize || !sameMembers) {
      throw Errors.badRequest("order must be an exact permutation of the group's teams");
    }

    await prisma.group.update({ where: { id }, data: { tiebreak: JSON.stringify(order) } });
    const category = await getCategoryOr404(group.categoryId);
    broadcaster.broadcast(category.tournamentId, "standings.updated", { groupId: id });
    return { groupId: id, order };
  });
}
