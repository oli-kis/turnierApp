import type { MatchListItem, MatchStatus } from "../api/types";

/**
 * A slot-grouped bucket of matches for the admin all-matches overview. Matches
 * without a slot land in a trailing „Ohne Runde" bucket (slotIndex null).
 */
export interface MatchGroup {
  /** Stable key: the slot id, or "none" for unscheduled matches. */
  key: string;
  /** 0-based slot index, or null when the matches have no slot. */
  slotIndex: number | null;
  plannedStart: string | null;
  /** Match-level estimated kickoff of the first match in the bucket. */
  estimatedStart: string | null;
  matches: MatchListItem[];
}

/** A finished or running match has a score worth correcting; scheduled ones don't. */
export function isScoreEditable(status: MatchStatus): boolean {
  return status === "FINISHED" || status === "RUNNING";
}

function pitchKey(m: MatchListItem): string {
  return m.pitch?.name ?? "￿"; // unpitched sorts last
}

/**
 * Group matches by slot, slots in ascending index order, the unscheduled bucket
 * last. Within a bucket, order by pitch name so a round reads left-to-right the
 * way the pitches are laid out. Pure — safe to unit test and memoize.
 */
export function groupMatchesBySlot(matches: MatchListItem[]): MatchGroup[] {
  const buckets = new Map<string, MatchGroup>();

  for (const m of matches) {
    const key = m.slot?.id ?? "none";
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        key,
        slotIndex: m.slot?.index ?? null,
        plannedStart: m.slot?.plannedStart ?? null,
        estimatedStart: m.estimatedStart ?? null,
        matches: [],
      };
      buckets.set(key, bucket);
    }
    bucket.matches.push(m);
  }

  for (const bucket of buckets.values()) {
    bucket.matches.sort((a, b) => pitchKey(a).localeCompare(pitchKey(b)));
  }

  return [...buckets.values()].sort((a, b) => {
    if (a.slotIndex === null) return 1;
    if (b.slotIndex === null) return -1;
    return a.slotIndex - b.slotIndex;
  });
}
