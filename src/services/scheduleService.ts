import { prisma } from "../db/client.js";
import { Errors } from "../lib/errors.js";
import { generateSchedule, type GroupInput } from "../domain/scheduler.js";
import { plannedStart } from "../domain/time.js";

export interface GenerateResult {
  slotCount: number;
  matchCount: number;
  restStats: { min: number; max: number; avg: number };
}

/**
 * Generate (or regenerate) the group-stage schedule for a tournament and persist
 * slots + matches. Round-robin per group, packed into global slots shared across
 * all categories under the tournament's pitch capacity.
 */
export async function generateGroupSchedule(tournamentId: string): Promise<GenerateResult> {
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    include: {
      pitches: { orderBy: { sortOrder: "asc" } },
      categories: { include: { groups: { include: { teams: true } } } },
    },
  });
  if (!tournament) throw Errors.notFound("Tournament");

  if (tournament.status !== "DRAFT" && tournament.status !== "SCHEDULED") {
    throw Errors.conflict(
      "REGEN_FORBIDDEN",
      "Schedule can only be generated while DRAFT or SCHEDULED",
    );
  }
  // No match may have started.
  const started = await prisma.slot.count({
    where: { tournamentId, actualStart: { not: null } },
  });
  if (started > 0) {
    throw Errors.conflict("REGEN_FORBIDDEN", "Cannot regenerate after a slot has started");
  }

  // Collect every group (across categories) that has teams; validate sizes.
  const groups: GroupInput[] = [];
  for (const category of tournament.categories) {
    for (const group of category.groups) {
      if (group.teams.length === 1) {
        throw Errors.unprocessable(
          "GROUP_TOO_SMALL",
          `Group "${group.name}" needs at least 2 teams`,
        );
      }
      if (group.teams.length >= 2) {
        groups.push({ groupId: group.id, teamIds: group.teams.map((t) => t.id) });
      }
    }
  }
  if (groups.length === 0) {
    throw Errors.unprocessable("NO_GROUPS", "No groups with at least 2 teams to schedule");
  }

  const result = generateSchedule({ groups, pitchCount: tournament.pitchCount });

  // Map groupId -> categoryId for match rows.
  const groupCategory = new Map<string, string>();
  for (const category of tournament.categories) {
    for (const group of category.groups) groupCategory.set(group.id, category.id);
  }
  const pitchByIndex = tournament.pitches; // already sorted by sortOrder

  await prisma.$transaction(async (tx) => {
    // Regeneration wipes existing group-stage slots and matches.
    await tx.match.deleteMany({ where: { tournamentId } });
    await tx.slot.deleteMany({ where: { tournamentId } });

    const slotIds: string[] = [];
    for (let index = 0; index < result.slotCount; index++) {
      const slot = await tx.slot.create({
        data: {
          tournamentId,
          index,
          plannedStart: plannedStart(
            tournament.startAt,
            index,
            tournament.matchDurationMin,
            tournament.transitionMin,
          ),
          status: "PENDING",
        },
      });
      slotIds.push(slot.id);
    }

    for (const m of result.matches) {
      const pitch = pitchByIndex[m.pitchIndex];
      await tx.match.create({
        data: {
          tournamentId,
          categoryId: groupCategory.get(m.groupId)!,
          groupId: m.groupId,
          slotId: slotIds[m.slotIndex]!,
          pitchId: pitch ? pitch.id : null,
          phase: "GROUP",
          status: "SCHEDULED",
          homeTeamId: m.homeTeamId,
          awayTeamId: m.awayTeamId,
        },
      });
    }

    await tx.tournament.update({ where: { id: tournamentId }, data: { status: "SCHEDULED" } });
  });

  return {
    slotCount: result.slotCount,
    matchCount: result.matches.length,
    restStats: result.restStats,
  };
}
