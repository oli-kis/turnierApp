import { prisma } from "../db/client.js";
import { Errors } from "./errors.js";

export async function getTournamentOr404(id: string) {
  const t = await prisma.tournament.findUnique({ where: { id } });
  if (!t) throw Errors.notFound("Tournament");
  return t;
}

export async function getCategoryOr404(id: string) {
  const c = await prisma.category.findUnique({ where: { id } });
  if (!c) throw Errors.notFound("Category");
  return c;
}

export async function getGroupOr404(id: string) {
  const g = await prisma.group.findUnique({ where: { id } });
  if (!g) throw Errors.notFound("Group");
  return g;
}

export async function getTeamOr404(id: string) {
  const t = await prisma.team.findUnique({ where: { id } });
  if (!t) throw Errors.notFound("Team");
  return t;
}

export async function getMatchOr404(id: string) {
  const m = await prisma.match.findUnique({ where: { id } });
  if (!m) throw Errors.notFound("Match");
  return m;
}

export async function getSlotOr404(id: string) {
  const s = await prisma.slot.findUnique({ where: { id } });
  if (!s) throw Errors.notFound("Slot");
  return s;
}

/** True once any group-stage schedule exists for the tournament. */
export async function scheduleExists(tournamentId: string): Promise<boolean> {
  const count = await prisma.slot.count({ where: { tournamentId } });
  return count > 0;
}
