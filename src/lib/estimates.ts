import { prisma } from "../db/client.js";
import { computeEstimatedStarts } from "../domain/time.js";

/** Estimated start per slot id for a tournament (computed, never persisted). */
export async function estimatedStartsBySlot(
  tournamentId: string,
): Promise<Map<string, Date>> {
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    include: { slots: { orderBy: { index: "asc" } } },
  });
  if (!tournament) return new Map();

  const byIndex = computeEstimatedStarts(
    tournament.slots.map((s) => ({
      index: s.index,
      plannedStart: s.plannedStart,
      actualStart: s.actualStart,
    })),
    tournament.matchDurationMin,
    tournament.transitionMin,
  );

  const bySlot = new Map<string, Date>();
  for (const slot of tournament.slots) {
    const est = byIndex.get(slot.index);
    if (est) bySlot.set(slot.id, est);
  }
  return bySlot;
}
