import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db/client.js";
import { Errors } from "../lib/errors.js";
import { getGroupOr404, getTeamOr404, getTournamentOr404 } from "../lib/loaders.js";
import { estimatedStartsBySlot } from "../lib/estimates.js";
import { computeStandings } from "../domain/standings.js";

const idParam = z.object({ id: z.string() });

export async function publicRoutes(app: FastifyInstance): Promise<void> {
  // Slots with planned/actual/estimated starts.
  app.get("/tournaments/:id/slots", async (request) => {
    const { id } = idParam.parse(request.params);
    await getTournamentOr404(id);
    const est = await estimatedStartsBySlot(id);
    const slots = await prisma.slot.findMany({
      where: { tournamentId: id },
      orderBy: { index: "asc" },
    });
    return {
      slots: slots.map((s) => ({
        id: s.id,
        index: s.index,
        status: s.status,
        plannedStart: s.plannedStart,
        actualStart: s.actualStart,
        estimatedStart: est.get(s.id) ?? null,
      })),
    };
  });

  // Group standings.
  app.get("/groups/:id/standings", async (request) => {
    const { id } = idParam.parse(request.params);
    const group = await prisma.group.findUnique({
      where: { id },
      include: { teams: true, category: true },
    });
    if (!group) throw Errors.notFound("Group");

    const finished = await prisma.match.findMany({
      where: { groupId: id, phase: "GROUP", status: "FINISHED" },
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
    const result = computeStandings(
      group.teams.map((t) => ({ id: t.id, name: t.name })),
      matches,
      {
        qualifiersPerGroup: group.category.qualifiersPerGroup ?? undefined,
        manualOrder,
      },
    );

    return {
      groupId: id,
      standings: result.rows,
      tieUnresolved: result.tieUnresolved,
      note: "Standings are computed from finished matches only; unplayed or withdrawn matches are ignored.",
    };
  });

  // Case-insensitive team name search within a tournament.
  app.get("/tournaments/:id/teams/search", async (request) => {
    const { id } = idParam.parse(request.params);
    const { q } = z.object({ q: z.string().default("") }).parse(request.query);
    await getTournamentOr404(id);
    const teams = await prisma.team.findMany({
      where: { category: { tournamentId: id } },
      include: { group: true, category: true },
    });
    const needle = q.trim().toLowerCase();
    const filtered = needle
      ? teams.filter((t) => t.name.toLowerCase().includes(needle))
      : teams;
    return {
      teams: filtered.map((t) => ({
        id: t.id,
        name: t.name,
        group: t.group?.name ?? null,
        category: t.category.name,
      })),
    };
  });

  // All matches of a team, chronological, with pitch and estimated start.
  app.get("/teams/:id/matches", async (request) => {
    const { id } = idParam.parse(request.params);
    const team = await getTeamOr404(id);
    const est = await estimatedStartsBySlot(
      (await prisma.category.findUnique({ where: { id: team.categoryId } }))!.tournamentId,
    );
    const matches = await prisma.match.findMany({
      where: { OR: [{ homeTeamId: id }, { awayTeamId: id }] },
      include: { slot: true, pitch: true, homeTeam: true, awayTeam: true },
      orderBy: [{ slot: { index: "asc" } }],
    });
    return {
      matches: matches.map((m) => ({
        id: m.id,
        phase: m.phase,
        status: m.status,
        pitch: m.pitch?.name ?? null,
        slotIndex: m.slot?.index ?? null,
        plannedStart: m.slot?.plannedStart ?? null,
        estimatedStart: m.slotId ? est.get(m.slotId) ?? null : null,
        homeTeam: m.homeTeam?.name ?? null,
        awayTeam: m.awayTeam?.name ?? null,
        scoreHome: m.scoreHome,
        scoreAway: m.scoreAway,
      })),
    };
  });
}
