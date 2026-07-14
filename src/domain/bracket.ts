/**
 * Knockout bracket generator — pure, no I/O.
 *
 * Given the qualifying teams (with their group position and standings figures),
 * it seeds them, builds a standard single-elimination tree with best-effort
 * same-group-rematch avoidance in round 1, and emits every match with its phase
 * and source descriptors. Round-1 sources are GROUP_RANK; later rounds reference
 * feeder matches by key via MATCH_WINNER / MATCH_LOSER; the third-place match is
 * fed by the two semifinal losers.
 *
 * This is the fairness-critical bracket logic and is unit-tested exhaustively.
 */

export type KnockoutPhase =
  | "ROUND_OF_16"
  | "QUARTERFINAL"
  | "SEMIFINAL"
  | "THIRD_PLACE"
  | "FINAL";

export interface Qualifier {
  teamId: string;
  groupId: string;
  /** 1-based rank within the group (1 = winner). */
  groupPosition: number;
  points: number;
  goalDifference: number;
  goalsFor: number;
}

export type SourceDesc =
  | { type: "GROUP_RANK"; groupId: string; rank: number }
  | { type: "MATCH_WINNER"; matchKey: string }
  | { type: "MATCH_LOSER"; matchKey: string };

export interface BracketMatch {
  key: string;
  phase: KnockoutPhase;
  round: number; // 0-based; 0 is the first round played
  indexInRound: number;
  /** Resolved for round 0 (groups are finished at generation); null otherwise. */
  homeTeamId: string | null;
  awayTeamId: string | null;
  homeSource: SourceDesc;
  awaySource: SourceDesc;
}

export interface BracketResult {
  /** Team ids in seed order, seed 1 first. */
  seeds: string[];
  matches: BracketMatch[];
}

const VALID_SIZES = [4, 8, 16];

/** Seed the qualifiers: group position first, then points, GD, goals scored. */
export function seedQualifiers(qualifiers: Qualifier[]): Qualifier[] {
  return [...qualifiers].sort((a, b) => {
    if (a.groupPosition !== b.groupPosition) return a.groupPosition - b.groupPosition;
    if (b.points !== a.points) return b.points - a.points;
    if (b.goalDifference !== a.goalDifference) return b.goalDifference - a.goalDifference;
    return b.goalsFor - a.goalsFor;
  });
}

/**
 * Bracket positions as 1-based seed numbers, arranged so the top seeds only meet
 * in the final. For n=4 → [1,4,2,3]; n=8 → [1,8,4,5,2,7,3,6].
 */
export function seedOrder(n: number): number[] {
  let seeds = [1, 2];
  const rounds = Math.log2(n);
  for (let r = 1; r < rounds; r++) {
    const sum = seeds.length * 2 + 1;
    const next: number[] = [];
    for (const s of seeds) {
      next.push(s);
      next.push(sum - s);
    }
    seeds = next;
  }
  return seeds;
}

function distanceToPhase(distanceFromFinal: number): KnockoutPhase {
  switch (distanceFromFinal) {
    case 0:
      return "FINAL";
    case 1:
      return "SEMIFINAL";
    case 2:
      return "QUARTERFINAL";
    default:
      return "ROUND_OF_16";
  }
}

export function generateBracket(qualifiers: Qualifier[]): BracketResult {
  const n = qualifiers.length;
  if (!VALID_SIZES.includes(n)) {
    throw new Error(`bracket size must be 4, 8 or 16, got ${n}`);
  }

  const seeded = seedQualifiers(qualifiers);
  const order = seedOrder(n); // 1-based seed numbers in bracket position order

  // Round-0 pairings from consecutive bracket positions.
  let firstRound: Qualifier[][] = [];
  for (let i = 0; i < n; i += 2) {
    const home = seeded[order[i]! - 1]!;
    const away = seeded[order[i + 1]! - 1]!;
    firstRound.push([home, away]);
  }
  firstRound = avoidSameGroupRematches(firstRound);

  const totalRounds = Math.log2(n);
  const matches: BracketMatch[] = [];

  // Round 0
  firstRound.forEach(([home, away], idx) => {
    matches.push({
      key: `R0M${idx}`,
      phase: distanceToPhase(totalRounds - 1),
      round: 0,
      indexInRound: idx,
      homeTeamId: home!.teamId,
      awayTeamId: away!.teamId,
      homeSource: { type: "GROUP_RANK", groupId: home!.groupId, rank: home!.groupPosition },
      awaySource: { type: "GROUP_RANK", groupId: away!.groupId, rank: away!.groupPosition },
    });
  });

  // Later rounds: winners of the two feeder matches.
  let prevCount = firstRound.length;
  for (let round = 1; round < totalRounds; round++) {
    const count = prevCount / 2;
    for (let m = 0; m < count; m++) {
      matches.push({
        key: `R${round}M${m}`,
        phase: distanceToPhase(totalRounds - 1 - round),
        round,
        indexInRound: m,
        homeTeamId: null,
        awayTeamId: null,
        homeSource: { type: "MATCH_WINNER", matchKey: `R${round - 1}M${2 * m}` },
        awaySource: { type: "MATCH_WINNER", matchKey: `R${round - 1}M${2 * m + 1}` },
      });
    }
    prevCount = count;
  }

  // Third place: losers of the two semifinals. Semifinal is round totalRounds-2.
  const sfRound = totalRounds - 2;
  matches.push({
    key: "TP",
    phase: "THIRD_PLACE",
    round: totalRounds - 1, // played in the same round tier as the final
    indexInRound: 0,
    homeTeamId: null,
    awayTeamId: null,
    homeSource: { type: "MATCH_LOSER", matchKey: `R${sfRound}M0` },
    awaySource: { type: "MATCH_LOSER", matchKey: `R${sfRound}M1` },
  });

  return { seeds: seeded.map((q) => q.teamId), matches };
}

/**
 * Best-effort removal of round-1 clashes where both teams come from the same
 * group. A clash is resolved by swapping one team with a same-tier team (same
 * group position) in another match, provided the swap introduces no new clash.
 */
function avoidSameGroupRematches(pairs: Qualifier[][]): Qualifier[][] {
  const clash = (pair: Qualifier[]) => pair[0]!.groupId === pair[1]!.groupId;

  for (let i = 0; i < pairs.length; i++) {
    if (!clash(pairs[i]!)) continue;

    let resolved = false;
    // Try swapping either team of the clashing match with either team of another
    // match, only among teams sharing the same group position (tier).
    for (let side = 0; side < 2 && !resolved; side++) {
      const teamI = pairs[i]![side]!;
      for (let j = 0; j < pairs.length && !resolved; j++) {
        if (j === i) continue;
        for (let js = 0; js < 2 && !resolved; js++) {
          const teamJ = pairs[j]![js]!;
          if (teamJ.groupPosition !== teamI.groupPosition) continue;

          // Apply swap tentatively.
          pairs[i]![side] = teamJ;
          pairs[j]![js] = teamI;
          if (!clash(pairs[i]!) && !clash(pairs[j]!)) {
            resolved = true;
          } else {
            // Revert.
            pairs[i]![side] = teamI;
            pairs[j]![js] = teamJ;
          }
        }
      }
    }
    // If unresolved, leave as-is (spec: best effort).
  }

  return pairs;
}
