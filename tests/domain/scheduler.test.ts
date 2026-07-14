import { describe, it, expect } from "vitest";
import {
  roundRobin,
  generateSchedule,
  computeRestStats,
  type ScheduledMatch,
} from "../../src/domain/scheduler.js";

function pairKey(a: string, b: string): string {
  return [a, b].sort().join("-");
}

describe("roundRobin", () => {
  it("every team plays every other exactly once (even count)", () => {
    const teams = ["a", "b", "c", "d"];
    const rounds = roundRobin(teams);
    expect(rounds).toHaveLength(3); // n-1
    const seen = new Set<string>();
    for (const round of rounds) {
      expect(round).toHaveLength(2); // n/2 matches per round
      for (const [h, a] of round) seen.add(pairKey(h, a));
    }
    // n*(n-1)/2 = 6 distinct pairings
    expect(seen.size).toBe(6);
  });

  it("no team appears twice within a round", () => {
    const rounds = roundRobin(["a", "b", "c", "d", "e", "f"]);
    for (const round of rounds) {
      const teamsInRound = round.flat();
      expect(new Set(teamsInRound).size).toBe(teamsInRound.length);
    }
  });

  it("odd counts add a bye: n rounds, one team rests each round", () => {
    const teams = ["a", "b", "c", "d", "e"];
    const rounds = roundRobin(teams);
    expect(rounds).toHaveLength(5); // n rounds for odd n
    for (const round of rounds) {
      expect(round).toHaveLength(2); // floor(5/2)
    }
    // still every pair once
    const seen = new Set<string>();
    for (const round of rounds) for (const [h, a] of round) seen.add(pairKey(h, a));
    expect(seen.size).toBe(10); // 5*4/2
  });

  it("handles the minimal 2-team group", () => {
    const rounds = roundRobin(["a", "b"]);
    expect(rounds).toHaveLength(1);
    expect(rounds[0]).toHaveLength(1);
  });
});

describe("generateSchedule", () => {
  it("keeps a group-round in one slot when it fits, and respects capacity", () => {
    const result = generateSchedule({
      groups: [{ groupId: "A", teamIds: ["a", "b", "c", "d"] }],
      pitchCount: 2,
    });
    // 6 matches, 2 per round, 2 pitches -> 3 slots
    expect(result.matches).toHaveLength(6);
    expect(result.slotCount).toBe(3);
    for (let s = 0; s < result.slotCount; s++) {
      const inSlot = result.matches.filter((m) => m.slotIndex === s);
      expect(inSlot.length).toBeLessThanOrEqual(2);
    }
  });

  it("never schedules a team twice in the same slot", () => {
    const result = generateSchedule({
      groups: [
        { groupId: "A", teamIds: ["a1", "a2", "a3", "a4"] },
        { groupId: "B", teamIds: ["b1", "b2", "b3"] },
      ],
      pitchCount: 2,
    });
    const bySlot = new Map<number, string[]>();
    for (const m of result.matches) {
      const list = bySlot.get(m.slotIndex) ?? [];
      list.push(m.homeTeamId, m.awayTeamId);
      bySlot.set(m.slotIndex, list);
    }
    for (const teamsInSlot of bySlot.values()) {
      expect(new Set(teamsInSlot).size).toBe(teamsInSlot.length);
    }
  });

  it("respects round order within a group", () => {
    const result = generateSchedule({
      groups: [{ groupId: "A", teamIds: ["a", "b", "c", "d"] }],
      pitchCount: 1,
    });
    const byRound = new Map<number, number[]>();
    for (const m of result.matches) {
      const list = byRound.get(m.round) ?? [];
      list.push(m.slotIndex);
      byRound.set(m.round, list);
    }
    // max slot of round r < min slot of round r+1
    for (let r = 0; r < 2; r++) {
      const maxR = Math.max(...byRound.get(r)!);
      const minNext = Math.min(...byRound.get(r + 1)!);
      expect(maxR).toBeLessThan(minNext);
    }
  });

  it("splits an oversized round across slots when pitches are scarce", () => {
    // one pitch, a round has 2 matches -> must split across two slots
    const result = generateSchedule({
      groups: [{ groupId: "A", teamIds: ["a", "b", "c", "d"] }],
      pitchCount: 1,
    });
    expect(result.matches).toHaveLength(6);
    for (const m of result.matches) {
      expect(result.matches.filter((x) => x.slotIndex === m.slotIndex)).toHaveLength(1);
    }
    expect(result.slotCount).toBe(6);
  });

  it("packs multiple groups to fill pitch capacity", () => {
    const result = generateSchedule({
      groups: [
        { groupId: "A", teamIds: ["a1", "a2", "a3", "a4"] },
        { groupId: "B", teamIds: ["b1", "b2", "b3", "b4"] },
      ],
      pitchCount: 4,
    });
    // 12 matches total; 2 groups * 2 matches/round = 4 fit per slot -> 3 slots
    expect(result.matches).toHaveLength(12);
    expect(result.slotCount).toBe(3);
  });

  it("assigns valid pitch indices within capacity, unique per slot", () => {
    const result = generateSchedule({
      groups: [
        { groupId: "A", teamIds: ["a1", "a2", "a3", "a4"] },
        { groupId: "B", teamIds: ["b1", "b2", "b3", "b4"] },
      ],
      pitchCount: 4,
    });
    const bySlot = new Map<number, number[]>();
    for (const m of result.matches) {
      expect(m.pitchIndex).toBeGreaterThanOrEqual(0);
      expect(m.pitchIndex).toBeLessThan(4);
      const list = bySlot.get(m.slotIndex) ?? [];
      list.push(m.pitchIndex);
      bySlot.set(m.slotIndex, list);
    }
    for (const pitches of bySlot.values()) {
      expect(new Set(pitches).size).toBe(pitches.length);
    }
  });

  it("reports rest stats", () => {
    const result = generateSchedule({
      groups: [{ groupId: "A", teamIds: ["a", "b", "c", "d"] }],
      pitchCount: 2,
    });
    expect(result.restStats.min).toBeGreaterThanOrEqual(1);
    expect(result.restStats.max).toBeGreaterThanOrEqual(result.restStats.min);
    expect(result.restStats.avg).toBeGreaterThan(0);
  });

  it("rejects groups smaller than 2 teams", () => {
    expect(() =>
      generateSchedule({ groups: [{ groupId: "A", teamIds: ["a"] }], pitchCount: 2 }),
    ).toThrow();
  });

  it("rejects pitchCount < 1", () => {
    expect(() =>
      generateSchedule({ groups: [{ groupId: "A", teamIds: ["a", "b"] }], pitchCount: 0 }),
    ).toThrow();
  });
});

describe("computeRestStats", () => {
  it("computes gap between consecutive slots per team", () => {
    const matches: ScheduledMatch[] = [
      { groupId: "A", homeTeamId: "a", awayTeamId: "b", round: 0, slotIndex: 0, pitchIndex: 0 },
      { groupId: "A", homeTeamId: "a", awayTeamId: "c", round: 1, slotIndex: 2, pitchIndex: 0 },
      { groupId: "A", homeTeamId: "a", awayTeamId: "d", round: 2, slotIndex: 5, pitchIndex: 0 },
    ];
    // team a plays slots 0,2,5 -> gaps 2 and 3
    const stats = computeRestStats(matches);
    expect(stats.min).toBe(2);
    expect(stats.max).toBe(3);
  });
});
