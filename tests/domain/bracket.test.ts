import { describe, it, expect } from "vitest";
import {
  seedOrder,
  seedQualifiers,
  generateBracket,
  type Qualifier,
} from "../../src/domain/bracket.js";

function qual(
  teamId: string,
  groupId: string,
  groupPosition: number,
  points: number,
  gd = 0,
  gf = 0,
): Qualifier {
  return { teamId, groupId, groupPosition, points, goalDifference: gd, goalsFor: gf };
}

/** Two groups × qualifiersPerGroup, no same-group clashes forced. */
function simpleQualifiers(n: number): Qualifier[] {
  const groups = 2;
  const perGroup = n / groups;
  const out: Qualifier[] = [];
  for (let g = 0; g < groups; g++) {
    for (let pos = 1; pos <= perGroup; pos++) {
      // higher group + better position => more points, kept distinct
      out.push(qual(`g${g}p${pos}`, `G${g}`, pos, 100 - g * 10 - pos));
    }
  }
  return out;
}

describe("seedOrder", () => {
  it("n=4 => [1,4,2,3]", () => {
    expect(seedOrder(4)).toEqual([1, 4, 2, 3]);
  });
  it("n=8 => [1,8,4,5,2,7,3,6]", () => {
    expect(seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
  });
  it("n=16 keeps seed 1 and 2 in opposite halves", () => {
    const order = seedOrder(16);
    expect(order).toHaveLength(16);
    const firstHalf = order.slice(0, 8);
    const secondHalf = order.slice(8);
    expect(firstHalf.includes(1)).toBe(true);
    expect(secondHalf.includes(2)).toBe(true);
  });
});

describe("seedQualifiers", () => {
  it("orders by group position first, then points/GD/GF", () => {
    const q = [
      qual("a2", "A", 2, 9, 9, 20), // runner-up, better GD within its tier
      qual("b1", "B", 1, 3, 0, 3),
      qual("a1", "A", 1, 9, 9, 9),
      qual("b2", "B", 2, 9, 5, 9),
    ];
    const seeded = seedQualifiers(q).map((s) => s.teamId);
    // position-1 first (a1 before b1 by points); within position-2, a2 (GD 9)
    // outranks b2 (GD 5)
    expect(seeded).toEqual(["a1", "b1", "a2", "b2"]);
  });
});

describe("generateBracket", () => {
  it("rejects non-4/8/16 sizes", () => {
    expect(() => generateBracket(simpleQualifiers(4).slice(0, 3))).toThrow();
    expect(() => generateBracket(simpleQualifiers(8).slice(0, 6))).toThrow();
  });

  for (const n of [4, 8, 16]) {
    it(`n=${n}: correct match count and phase structure`, () => {
      const { matches, seeds } = generateBracket(simpleQualifiers(n));
      expect(seeds).toHaveLength(n);
      // total knockout matches = (n-1) bracket matches + 1 third place
      expect(matches).toHaveLength(n - 1 + 1);
      expect(matches.filter((m) => m.phase === "FINAL")).toHaveLength(1);
      expect(matches.filter((m) => m.phase === "THIRD_PLACE")).toHaveLength(1);
      expect(matches.filter((m) => m.phase === "SEMIFINAL")).toHaveLength(2);
      // round 0 has n/2 matches with resolved teams and GROUP_RANK sources
      const round0 = matches.filter((m) => m.round === 0);
      expect(round0).toHaveLength(n / 2);
      for (const m of round0) {
        expect(m.homeTeamId).not.toBeNull();
        expect(m.awayTeamId).not.toBeNull();
        expect(m.homeSource.type).toBe("GROUP_RANK");
        expect(m.awaySource.type).toBe("GROUP_RANK");
      }
    });
  }

  it("n=8: quarterfinals in round 0, final in last round", () => {
    const { matches } = generateBracket(simpleQualifiers(8));
    expect(matches.filter((m) => m.phase === "QUARTERFINAL")).toHaveLength(4);
    const r0 = matches.filter((m) => m.round === 0);
    expect(r0.every((m) => m.phase === "QUARTERFINAL")).toBe(true);
  });

  it("later-round sources reference feeder match keys", () => {
    const { matches } = generateBracket(simpleQualifiers(8));
    const semi0 = matches.find((m) => m.phase === "SEMIFINAL" && m.indexInRound === 0)!;
    expect(semi0.homeSource).toEqual({ type: "MATCH_WINNER", matchKey: "R0M0" });
    expect(semi0.awaySource).toEqual({ type: "MATCH_WINNER", matchKey: "R0M1" });
  });

  it("third place is fed by the two semifinal losers", () => {
    const { matches } = generateBracket(simpleQualifiers(8));
    const tp = matches.find((m) => m.phase === "THIRD_PLACE")!;
    const sfRound = Math.log2(8) - 2; // 1
    expect(tp.homeSource).toEqual({ type: "MATCH_LOSER", matchKey: `R${sfRound}M0` });
    expect(tp.awaySource).toEqual({ type: "MATCH_LOSER", matchKey: `R${sfRound}M1` });
  });

  it("avoids same-group round-1 rematches when resolvable", () => {
    // Group A holds the strongest winner and weakest runner-up; group B the
    // reverse. The naive pairing would put A1 vs A2 and B1 vs B2.
    const q: Qualifier[] = [
      qual("a1", "A", 1, 10),
      qual("b1", "B", 1, 6),
      qual("b2", "B", 2, 5),
      qual("a2", "A", 2, 1),
    ];
    const { matches } = generateBracket(q);
    const round0 = matches.filter((m) => m.round === 0);
    for (const m of round0) {
      const home = q.find((x) => x.teamId === m.homeTeamId)!;
      const away = q.find((x) => x.teamId === m.awayTeamId)!;
      expect(home.groupId).not.toBe(away.groupId);
    }
  });

  it("every non-final team plays exactly once in round 0", () => {
    const { matches } = generateBracket(simpleQualifiers(16));
    const round0 = matches.filter((m) => m.round === 0);
    const teams = round0.flatMap((m) => [m.homeTeamId, m.awayTeamId]);
    expect(new Set(teams).size).toBe(16);
  });
});
