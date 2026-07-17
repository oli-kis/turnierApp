import type { Category, MatchListItem, Slot, TournamentDetail } from "../api/types";

/**
 * Builds the page cycle for the clubhouse beamer.
 *
 * A projector has no one to operate it, so the deck has to compose itself from
 * whatever the tournament currently is: live scores while matches run, the next
 * slot's kickoff times while they don't, then every group table and bracket. A
 * page with nothing to show is never emitted — an empty screen on the wall reads
 * as "the app is broken".
 */

export type BeamerPage =
  | { kind: "live"; title: string; matches: MatchListItem[]; slot: Slot }
  | { kind: "next"; title: string; matches: MatchListItem[]; slot: Slot }
  | { kind: "standings"; title: string; groupId: string; categoryName: string; qualifiersPerGroup?: number | null }
  | { kind: "bracket"; title: string; categoryId: string; categoryName: string };

interface BuildInput {
  tournament?: TournamentDetail;
  slots?: Slot[];
  matches?: MatchListItem[];
}

function matchesInSlot(matches: MatchListItem[], slot: Slot): MatchListItem[] {
  return matches.filter((m) => m.slot?.index === slot.index);
}

function categoryPages(categories: Category[]): BeamerPage[] {
  const pages: BeamerPage[] = [];

  for (const cat of categories) {
    for (const group of cat.groups ?? []) {
      pages.push({
        kind: "standings",
        title: `${cat.name} — Gruppe ${group.name}`,
        groupId: group.id,
        categoryName: cat.name,
        qualifiersPerGroup: cat.qualifiersPerGroup,
      });
    }
  }

  // Brackets last: they only exist late in the day, and they are the payoff.
  for (const cat of categories) {
    if (cat.knockoutGenerated) {
      pages.push({
        kind: "bracket",
        title: `${cat.name} — Finalrunde`,
        categoryId: cat.id,
        categoryName: cat.name,
      });
    }
  }

  return pages;
}

export function buildBeamerPages({ tournament, slots, matches }: BuildInput): BeamerPage[] {
  const pages: BeamerPage[] = [];
  const allMatches = matches ?? [];
  const allSlots = slots ?? [];

  const runningSlot = allSlots.find((s) => s.status === "RUNNING");
  const live = runningSlot ? matchesInSlot(allMatches, runningSlot) : [];

  if (runningSlot && live.length > 0) {
    pages.push({ kind: "live", title: "Jetzt läuft", matches: live, slot: runningSlot });
  } else {
    // Nothing running: the next kickoff is the most useful thing on the wall.
    const nextSlot =
      allSlots.find((s) => s.status === "WAITING_READY") ??
      allSlots.find((s) => s.status === "PENDING");
    const upcoming = nextSlot ? matchesInSlot(allMatches, nextSlot) : [];
    if (nextSlot && upcoming.length > 0) {
      pages.push({ kind: "next", title: "Als Nächstes", matches: upcoming, slot: nextSlot });
    }
  }

  pages.push(...categoryPages(tournament?.categories ?? []));
  return pages;
}
