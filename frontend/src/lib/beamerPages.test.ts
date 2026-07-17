import { describe, it, expect } from "vitest";
import { buildBeamerPages } from "./beamerPages";
import type { Category, MatchListItem, Slot, TournamentDetail } from "../api/types";

/**
 * The beamer runs unattended all day, so the deck must be right for every stage
 * of the tournament — before the first whistle, mid-slot, and after the final.
 */

const slot = (index: number, status: Slot["status"]): Slot => ({
  id: `s${index}`,
  index,
  status,
  plannedStart: "2026-05-16T09:00:00.000Z",
  actualStart: status === "RUNNING" ? "2026-05-16T09:02:00.000Z" : null,
  estimatedStart: null,
});

const match = (id: string, slotIndex: number): MatchListItem => ({
  id,
  phase: "GROUP",
  status: "RUNNING",
  scoreHome: 0,
  scoreAway: 0,
  slot: { id: `s${slotIndex}`, index: slotIndex, status: "RUNNING", plannedStart: null },
  homeTeam: { id: "h", name: "Heim" },
  awayTeam: { id: "a", name: "Gast" },
});

const category = (over: Partial<Category> = {}): Category => ({
  id: "c1",
  tournamentId: "t1",
  name: "E-Junioren",
  knockoutGenerated: false,
  qualifiersPerGroup: 2,
  groups: [{ id: "g1", categoryId: "c1", name: "A" }],
  ...over,
});

const tournament = (categories: Category[]): TournamentDetail => ({
  id: "t1",
  name: "FC Frick Turnier",
  startAt: "2026-05-16T08:00:00.000Z",
  matchDurationMin: 12,
  transitionMin: 3,
  pitchCount: 2,
  status: "RUNNING",
  categories,
});

describe("buildBeamerPages", () => {
  it("leads with the running slot's live scores", () => {
    const pages = buildBeamerPages({
      tournament: tournament([category()]),
      slots: [slot(0, "FINISHED"), slot(1, "RUNNING")],
      matches: [match("m1", 1), match("m2", 1), match("old", 0)],
    });

    expect(pages[0].kind).toBe("live");
    expect(pages[0]).toMatchObject({ title: "Jetzt läuft" });
    const livePage = pages[0] as Extract<typeof pages[number], { kind: "live" }>;
    expect(livePage.matches.map((m) => m.id)).toEqual(["m1", "m2"]);
  });

  it("falls back to the next kickoff when nothing is running", () => {
    const pages = buildBeamerPages({
      tournament: tournament([category()]),
      slots: [slot(0, "FINISHED"), slot(1, "WAITING_READY")],
      matches: [match("m1", 1)],
    });

    expect(pages[0]).toMatchObject({ kind: "next", title: "Als Nächstes" });
  });

  it("prefers a waiting slot over a later pending one", () => {
    const pages = buildBeamerPages({
      tournament: tournament([]),
      slots: [slot(1, "WAITING_READY"), slot(2, "PENDING")],
      matches: [match("m1", 1), match("m2", 2)],
    });

    const next = pages[0] as Extract<typeof pages[number], { kind: "next" }>;
    expect(next.slot.index).toBe(1);
    expect(next.matches.map((m) => m.id)).toEqual(["m1"]);
  });

  it("emits no live page for a running slot with no matches loaded yet", () => {
    const pages = buildBeamerPages({
      tournament: tournament([category()]),
      slots: [slot(1, "RUNNING")],
      matches: [],
    });

    expect(pages.every((p) => p.kind !== "live")).toBe(true);
  });

  it("adds one standings page per group, across categories", () => {
    const pages = buildBeamerPages({
      tournament: tournament([
        category({
          id: "c1",
          name: "E",
          groups: [
            { id: "g1", categoryId: "c1", name: "A" },
            { id: "g2", categoryId: "c1", name: "B" },
          ],
        }),
        category({ id: "c2", name: "F", groups: [{ id: "g3", categoryId: "c2", name: "A" }] }),
      ]),
      slots: [],
      matches: [],
    });

    expect(pages.map((p) => p.title)).toEqual([
      "E — Gruppe A",
      "E — Gruppe B",
      "F — Gruppe A",
    ]);
  });

  it("carries the qualification cut into the standings page", () => {
    const pages = buildBeamerPages({
      tournament: tournament([category({ qualifiersPerGroup: 2 })]),
      slots: [],
      matches: [],
    });

    expect(pages[0]).toMatchObject({ kind: "standings", groupId: "g1", qualifiersPerGroup: 2 });
  });

  it("shows brackets only once a knockout exists, and after the group tables", () => {
    const withoutKo = buildBeamerPages({
      tournament: tournament([category()]),
      slots: [],
      matches: [],
    });
    expect(withoutKo.some((p) => p.kind === "bracket")).toBe(false);

    const withKo = buildBeamerPages({
      tournament: tournament([category({ knockoutGenerated: true })]),
      slots: [],
      matches: [],
    });
    expect(withKo.map((p) => p.kind)).toEqual(["standings", "bracket"]);
    expect(withKo[1]).toMatchObject({ categoryId: "c1", title: "E-Junioren — Finalrunde" });
  });

  it("returns an empty deck rather than blank pages when there is nothing to show", () => {
    expect(buildBeamerPages({})).toEqual([]);
  });
});
