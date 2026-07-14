/**
 * Pure time computations for the tournament schedule.
 *
 * `plannedStart` is persisted per slot. Estimated starts are always computed
 * from planned + actual starts, never stored (per CLAUDE.md).
 */

const MS_PER_MIN = 60_000;

/** Slot cycle length in minutes: one match plus the transition after it. */
export function slotCycleMin(matchDurationMin: number, transitionMin: number): number {
  return matchDurationMin + transitionMin;
}

/** plannedStart = startAt + index * (matchDurationMin + transitionMin). */
export function plannedStart(
  startAt: Date,
  index: number,
  matchDurationMin: number,
  transitionMin: number,
): Date {
  return new Date(
    startAt.getTime() + index * slotCycleMin(matchDurationMin, transitionMin) * MS_PER_MIN,
  );
}

export interface SlotTiming {
  index: number;
  plannedStart: Date;
  actualStart: Date | null;
}

/**
 * Estimated start per slot, in index order.
 *
 * - If a slot already started, its estimated start is its actual start.
 * - Otherwise it is max(plannedStart, previousEstimatedStart + cycle), so a late
 *   slot pushes every later slot but a slot can never start before its plan.
 */
export function computeEstimatedStarts(
  slots: SlotTiming[],
  matchDurationMin: number,
  transitionMin: number,
): Map<number, Date> {
  const cycleMs = slotCycleMin(matchDurationMin, transitionMin) * MS_PER_MIN;
  const ordered = [...slots].sort((a, b) => a.index - b.index);
  const result = new Map<number, Date>();
  let prevStart: Date | null = null;

  for (const slot of ordered) {
    let est: Date;
    if (slot.actualStart) {
      est = slot.actualStart;
    } else if (prevStart === null) {
      est = slot.plannedStart;
    } else {
      const earliest = prevStart.getTime() + cycleMs;
      est = new Date(Math.max(slot.plannedStart.getTime(), earliest));
    }
    result.set(slot.index, est);
    prevStart = est;
  }

  return result;
}
