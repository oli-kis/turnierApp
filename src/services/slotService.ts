import { prisma } from "../db/client.js";
import { broadcaster } from "../sse/broadcaster.js";

/**
 * Central slot-cascade logic — the one place synchronized starts and slot
 * completion are decided.
 *
 * - A slot starts (RUNNING) the moment every match it holds is READY.
 * - A slot finishes when every match it holds is FINISHED; finishing it moves
 *   the next slot into WAITING_READY.
 *
 * Estimated start times are never persisted; clients recompute them from the
 * `schedule.updated` signal via GET /tournaments/:id/slots.
 */

/**
 * Start the slot if all its matches are READY. Safe to call after any ready.
 * An empty WAITING_READY slot is treated as already finished and advances.
 */
export async function maybeStartSlot(tournamentId: string, slotId: string): Promise<void> {
  const slot = await prisma.slot.findUnique({
    where: { id: slotId },
    include: { matches: true },
  });
  if (!slot || slot.status !== "WAITING_READY") return;

  if (slot.matches.length === 0) {
    await finishSlotAndAdvance(tournamentId, slotId);
    return;
  }

  const allReady = slot.matches.every((m) => m.status === "READY");
  if (!allReady) return;

  await prisma.$transaction([
    prisma.slot.update({
      where: { id: slotId },
      data: { status: "RUNNING", actualStart: new Date() },
    }),
    prisma.match.updateMany({
      where: { slotId, status: "READY" },
      data: { status: "RUNNING" },
    }),
  ]);

  broadcaster.broadcast(tournamentId, "slot.started", { slotId, index: slot.index });
  broadcaster.broadcast(tournamentId, "schedule.updated", { slotId });
}

/**
 * Finish the slot if all its matches are FINISHED, then open the next slot.
 * Safe to call after any match finish.
 */
export async function maybeFinishSlot(tournamentId: string, slotId: string): Promise<void> {
  const slot = await prisma.slot.findUnique({
    where: { id: slotId },
    include: { matches: true },
  });
  if (!slot || slot.status !== "RUNNING") return;

  const allFinished =
    slot.matches.length === 0 || slot.matches.every((m) => m.status === "FINISHED");
  if (!allFinished) return;

  await finishSlotAndAdvance(tournamentId, slotId);
}

async function finishSlotAndAdvance(tournamentId: string, slotId: string): Promise<void> {
  const slot = await prisma.slot.findUnique({ where: { id: slotId } });
  if (!slot) return;

  await prisma.slot.update({ where: { id: slotId }, data: { status: "FINISHED" } });
  broadcaster.broadcast(tournamentId, "slot.finished", { slotId, index: slot.index });

  const next = await prisma.slot.findFirst({
    where: { tournamentId, index: slot.index + 1 },
  });
  if (next && next.status === "PENDING") {
    await prisma.slot.update({ where: { id: next.id }, data: { status: "WAITING_READY" } });
    broadcaster.broadcast(tournamentId, "slot.waiting-ready", {
      slotId: next.id,
      index: next.index,
    });
    // A newly-opened slot may already be empty (all matches withdrawn).
    await maybeStartSlot(tournamentId, next.id);
  }

  broadcaster.broadcast(tournamentId, "schedule.updated", { slotId });
}
