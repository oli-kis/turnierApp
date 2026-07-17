import type { Prisma } from "@prisma/client";
import { prisma } from "../db/client.js";
import { Errors } from "../lib/errors.js";
import { computeStandings } from "../domain/standings.js";
import { generateBracket, type Qualifier, type BracketMatch } from "../domain/bracket.js";
import { plannedStart } from "../domain/time.js";
import { notifySlotWaitingReady } from "./pushService.js";
import { broadcaster } from "../sse/broadcaster.js";

export interface KnockoutResult {
  bracketSize: number;
  matches: number;
  seeds: string[];
}

/**
 * Generate the knockout bracket for a category: validate preconditions, seed the
 * qualifiers from final group standings, persist the match tree with sources,
 * slot it after the group stage (reusing PENDING knockout slots across
 * categories where possible), and open the first knockout slot if the tournament
 * is already running.
 */
export async function generateKnockout(categoryId: string): Promise<KnockoutResult> {
  const category = await prisma.category.findUnique({
    where: { id: categoryId },
    include: {
      tournament: { include: { pitches: { orderBy: { sortOrder: "asc" } } } },
      groups: { include: { teams: true } },
    },
  });
  if (!category) throw Errors.notFound("Category");
  if (category.knockoutGenerated) {
    throw Errors.conflict("ALREADY_GENERATED", "Knockout already generated");
  }
  if (category.qualifiersPerGroup == null) {
    throw Errors.unprocessable("QUALIFIERS_UNSET", "qualifiersPerGroup is not set");
  }

  const groupCount = category.groups.length;
  const bracketSize = groupCount * category.qualifiersPerGroup;
  if (![4, 8, 16].includes(bracketSize)) {
    throw Errors.unprocessable(
      "INVALID_BRACKET_SIZE",
      `groups(${groupCount}) × qualifiersPerGroup(${category.qualifiersPerGroup}) = ${bracketSize}, must be 4, 8 or 16`,
    );
  }

  // All group matches finished?
  const unfinished = await prisma.match.count({
    where: { categoryId, phase: "GROUP", status: { not: "FINISHED" } },
  });
  if (unfinished > 0) {
    throw Errors.conflict("GROUP_STAGE_INCOMPLETE", "Not all group matches are finished");
  }

  // Build qualifiers from each group's final standings; refuse on unresolved ties.
  const qualifiers: Qualifier[] = [];
  for (const group of category.groups) {
    const finished = await prisma.match.findMany({
      where: { groupId: group.id, phase: "GROUP", status: "FINISHED" },
      select: { homeTeamId: true, awayTeamId: true, scoreHome: true, scoreAway: true },
    });
    const matches = finished
      .filter((m) => m.homeTeamId && m.awayTeamId)
      .map((m) => ({
        homeTeamId: m.homeTeamId!,
        awayTeamId: m.awayTeamId!,
        scoreHome: m.scoreHome,
        scoreAway: m.scoreAway,
      }));
    const manualOrder = group.tiebreak ? (JSON.parse(group.tiebreak) as string[]) : undefined;
    const standings = computeStandings(
      group.teams.map((t) => ({ id: t.id, name: t.name })),
      matches,
      { qualifiersPerGroup: category.qualifiersPerGroup, manualOrder },
    );
    if (standings.tieUnresolved) {
      throw Errors.conflict(
        "TIE_UNRESOLVED",
        `Group "${group.name}" has an unresolved qualification tie; resolve it first`,
      );
    }
    for (let i = 0; i < category.qualifiersPerGroup; i++) {
      const row = standings.rows[i]!;
      qualifiers.push({
        teamId: row.teamId,
        groupId: group.id,
        groupPosition: row.rank,
        points: row.points,
        goalDifference: row.goalDifference,
        goalsFor: row.goalsFor,
      });
    }
  }

  const bracket = generateBracket(qualifiers);
  const tournamentId = category.tournamentId;

  await prisma.$transaction(async (tx) => {
    // Pass 1: create matches, remembering key -> id.
    const keyToId = new Map<string, string>();
    for (const bm of bracket.matches) {
      const created = await tx.match.create({
        data: {
          tournamentId,
          categoryId,
          phase: bm.phase,
          status: "SCHEDULED",
          bracketSlot: bm.indexInRound,
          homeTeamId: bm.homeTeamId,
          awayTeamId: bm.awayTeamId,
          homeSource: bm.homeSource.type === "GROUP_RANK" ? JSON.stringify(bm.homeSource) : null,
          awaySource: bm.awaySource.type === "GROUP_RANK" ? JSON.stringify(bm.awaySource) : null,
        },
      });
      keyToId.set(bm.key, created.id);
    }

    // Pass 2: rewrite MATCH_WINNER / MATCH_LOSER sources with real match ids.
    for (const bm of bracket.matches) {
      const id = keyToId.get(bm.key)!;
      const data: { homeSource?: string; awaySource?: string } = {};
      if (bm.homeSource.type !== "GROUP_RANK") {
        data.homeSource = JSON.stringify({
          type: bm.homeSource.type,
          matchId: keyToId.get(bm.homeSource.matchKey)!,
        });
      }
      if (bm.awaySource.type !== "GROUP_RANK") {
        data.awaySource = JSON.stringify({
          type: bm.awaySource.type,
          matchId: keyToId.get(bm.awaySource.matchKey)!,
        });
      }
      if (Object.keys(data).length > 0) {
        await tx.match.update({ where: { id }, data });
      }
    }

    await slotKnockoutMatches(tx, tournamentId, category.tournament, bracket.matches, keyToId);

    await tx.category.update({ where: { id: categoryId }, data: { knockoutGenerated: true } });
  });

  await activateFirstIdleSlot(tournamentId);
  broadcaster.broadcast(tournamentId, "bracket.updated", { categoryId });

  return {
    bracketSize,
    matches: bracket.matches.length,
    seeds: bracket.seeds,
  };
}

interface SlotFill {
  index: number;
  count: number;
  pitches: Set<number>;
}

/**
 * Assign knockout matches to slots. Placement order keeps rounds sequential and
 * the third-place match before the final. Reuses existing PENDING knockout slots
 * (from other categories) with free capacity, else appends new slots.
 */
async function slotKnockoutMatches(
  tx: Prisma.TransactionClient,
  tournamentId: string,
  tournament: { startAt: Date; matchDurationMin: number; transitionMin: number; pitchCount: number; pitches: { id: string; sortOrder: number }[] },
  bracketMatches: BracketMatch[],
  keyToId: Map<string, string>,
): Promise<void> {
  const pitchCount = tournament.pitchCount;
  const pitches = tournament.pitches;

  // Existing slots: track PENDING ones as reusable; know the global max index.
  const existing = await tx.slot.findMany({
    where: { tournamentId },
    include: { matches: { select: { pitchId: true } } },
    orderBy: { index: "asc" },
  });
  let globalMaxIndex = existing.reduce((max, s) => Math.max(max, s.index), -1);

  const reusable = new Map<string, SlotFill>(); // slotId -> fill (PENDING only)
  for (const s of existing) {
    if (s.status !== "PENDING") continue;
    const pitchSet = new Set<number>();
    for (const m of s.matches) {
      const idx = pitches.findIndex((p) => p.id === m.pitchId);
      if (idx >= 0) pitchSet.add(idx);
    }
    reusable.set(s.id, { index: s.index, count: s.matches.length, pitches: pitchSet });
  }

  const createSlot = async (index: number): Promise<string> => {
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
    reusable.set(slot.id, { index, count: 0, pitches: new Set() });
    return slot.id;
  };

  // Placement groups: round 0..semifinal, then third place, then final.
  const totalRounds = Math.max(...bracketMatches.map((m) => m.round)) + 1;
  const semifinalRound = totalRounds - 2;
  const groupsInOrder: BracketMatch[][] = [];
  for (let r = 0; r <= semifinalRound; r++) {
    groupsInOrder.push(bracketMatches.filter((m) => m.round === r && m.phase !== "THIRD_PLACE"));
  }
  groupsInOrder.push(bracketMatches.filter((m) => m.phase === "THIRD_PLACE"));
  groupsInOrder.push(bracketMatches.filter((m) => m.phase === "FINAL"));

  let minAllowedIndex = 0;
  for (const groupMatches of groupsInOrder) {
    if (groupMatches.length === 0) continue;
    let maxUsedIndex = minAllowedIndex - 1;

    for (const bm of groupMatches) {
      // Find the lowest-index reusable slot at/after the threshold with a free pitch.
      let chosen: { slotId: string; fill: SlotFill } | null = null;
      for (const [slotId, fill] of reusable) {
        if (fill.index < minAllowedIndex) continue;
        if (fill.count >= pitchCount) continue;
        if (!chosen || fill.index < chosen.fill.index) chosen = { slotId, fill };
      }
      if (!chosen) {
        const index = ++globalMaxIndex;
        const slotId = await createSlot(index);
        chosen = { slotId, fill: reusable.get(slotId)! };
      }

      // Lowest free pitch in the chosen slot.
      let pitchIndex = 0;
      while (chosen.fill.pitches.has(pitchIndex)) pitchIndex++;
      chosen.fill.pitches.add(pitchIndex);
      chosen.fill.count++;

      await tx.match.update({
        where: { id: keyToId.get(bm.key)! },
        data: { slotId: chosen.slotId, pitchId: pitches[pitchIndex]?.id ?? null },
      });
      maxUsedIndex = Math.max(maxUsedIndex, chosen.fill.index);
    }

    // Next placement group must start strictly after this one's slots.
    minAllowedIndex = maxUsedIndex + 1;
  }
}

/**
 * If the tournament is running and no slot is currently active, open the
 * lowest-index PENDING slot. Used after appending knockout slots once the group
 * stage has already finished.
 */
async function activateFirstIdleSlot(tournamentId: string): Promise<void> {
  const tournament = await prisma.tournament.findUnique({ where: { id: tournamentId } });
  if (!tournament || tournament.status !== "RUNNING") return;

  const active = await prisma.slot.count({
    where: { tournamentId, status: { in: ["WAITING_READY", "RUNNING"] } },
  });
  if (active > 0) return;

  const next = await prisma.slot.findFirst({
    where: { tournamentId, status: "PENDING" },
    orderBy: { index: "asc" },
  });
  if (!next) return;

  await prisma.slot.update({ where: { id: next.id }, data: { status: "WAITING_READY" } });
  broadcaster.broadcast(tournamentId, "slot.waiting-ready", { slotId: next.id, index: next.index });
  notifySlotWaitingReady(next.id);
}
