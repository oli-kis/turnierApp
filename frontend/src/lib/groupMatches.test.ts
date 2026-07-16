import { describe, it, expect } from "vitest";
import { groupMatchesBySlot, isScoreEditable } from "./groupMatches";
import type { MatchListItem, MatchStatus } from "../api/types";

function match(partial: Partial<MatchListItem> & { id: string }): MatchListItem {
  return {
    phase: "GROUP",
    status: "SCHEDULED",
    scoreHome: 0,
    scoreAway: 0,
    homeTeam: { id: `${partial.id}-h`, name: "Home" },
    awayTeam: { id: `${partial.id}-a`, name: "Away" },
    ...partial,
  };
}

function slot(index: number, plannedStart = `2026-07-15T1${index}:00:00Z`) {
  return { id: `s${index}`, index, status: "PENDING" as const, plannedStart };
}

describe("groupMatchesBySlot", () => {
  it("groups by slot and orders slots by ascending index", () => {
    const groups = groupMatchesBySlot([
      match({ id: "b", slot: slot(1), pitch: { id: "p1", name: "Platz 1" } }),
      match({ id: "a", slot: slot(0), pitch: { id: "p1", name: "Platz 1" } }),
    ]);
    expect(groups.map((g) => g.slotIndex)).toEqual([0, 1]);
    expect(groups[0].matches[0].id).toBe("a");
  });

  it("orders matches within a slot by pitch name", () => {
    const [group] = groupMatchesBySlot([
      match({ id: "p2", slot: slot(0), pitch: { id: "p2", name: "Platz 2" } }),
      match({ id: "p1", slot: slot(0), pitch: { id: "p1", name: "Platz 1" } }),
    ]);
    expect(group.matches.map((m) => m.id)).toEqual(["p1", "p2"]);
  });

  it("puts unscheduled matches in a trailing null bucket", () => {
    const groups = groupMatchesBySlot([
      match({ id: "loose" }),
      match({ id: "scheduled", slot: slot(0) }),
    ]);
    expect(groups.map((g) => g.slotIndex)).toEqual([0, null]);
    expect(groups[1].key).toBe("none");
  });

  it("carries the slot planned time and first match's estimated start", () => {
    const [group] = groupMatchesBySlot([
      match({ id: "a", slot: slot(0, "2026-07-15T10:00:00Z"), estimatedStart: "2026-07-15T10:12:00Z" }),
    ]);
    expect(group.plannedStart).toBe("2026-07-15T10:00:00Z");
    expect(group.estimatedStart).toBe("2026-07-15T10:12:00Z");
  });
});

describe("isScoreEditable", () => {
  it("allows editing finished and running matches", () => {
    expect(isScoreEditable("FINISHED")).toBe(true);
    expect(isScoreEditable("RUNNING")).toBe(true);
  });

  it("blocks editing scheduled and ready matches", () => {
    const notEditable: MatchStatus[] = ["SCHEDULED", "READY"];
    for (const s of notEditable) expect(isScoreEditable(s)).toBe(false);
  });
});
