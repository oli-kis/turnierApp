/**
 * Group-stage scheduler — pure, no I/O.
 *
 * Produces a round-robin (circle method) inside each group, packs the resulting
 * round units into global slots bounded by pitch capacity, and reports per-team
 * rest statistics so the admin can judge fairness.
 *
 * Fairness objective (CLAUDE.md): minimise variance of the gap, in slots,
 * between consecutive matches of each team. We approach it greedily by giving
 * scarce pitch capacity to the groups whose teams have waited longest, which
 * maximises the minimum rest.
 */

export interface GroupInput {
  groupId: string;
  /** Team ids in the group; order is irrelevant. */
  teamIds: string[];
}

export interface ScheduleInput {
  groups: GroupInput[];
  pitchCount: number;
}

export interface ScheduledMatch {
  groupId: string;
  homeTeamId: string;
  awayTeamId: string;
  /** Round index within the group's round-robin (0-based). */
  round: number;
  /** Global slot index (0-based). */
  slotIndex: number;
  /** Pitch index within the slot (0-based). */
  pitchIndex: number;
}

export interface RestStats {
  /** Smallest gap, in slots, any team has between two consecutive matches. */
  min: number;
  /** Largest such gap. */
  max: number;
  /** Mean gap across all teams' consecutive-match pairs. */
  avg: number;
}

export interface ScheduleResult {
  slotCount: number;
  matches: ScheduledMatch[];
  restStats: RestStats;
}

type Pairing = [home: string, away: string];

/**
 * Circle-method round-robin. Every team plays every other team exactly once.
 * Odd team counts add a bye: that team simply sits out one round.
 */
export function roundRobin(teamIds: string[]): Pairing[][] {
  const teams: (string | null)[] = [...teamIds];
  if (teams.length % 2 !== 0) teams.push(null); // bye marker
  const m = teams.length;
  const rounds: Pairing[][] = [];
  if (m < 2) return rounds;

  const arr = [...teams];
  for (let r = 0; r < m - 1; r++) {
    const round: Pairing[] = [];
    for (let i = 0; i < m / 2; i++) {
      const home = arr[i];
      const away = arr[m - 1 - i];
      if (home !== null && away !== null) {
        // Alternate home/away by round for a fairer venue split.
        if (r % 2 === 0) round.push([home, away]);
        else round.push([away, home]);
      }
    }
    rounds.push(round);
    // Rotate all but the first element clockwise.
    const fixed = arr[0]!;
    const rest = arr.slice(1);
    const last = rest.pop()!;
    rest.unshift(last);
    arr.splice(0, arr.length, fixed, ...rest);
  }
  return rounds;
}

interface GroupState {
  groupId: string;
  rounds: Pairing[][];
  roundIndex: number; // current round being placed
  pending: Pairing[]; // matches of the current round not yet placed
  lastPlacedSlot: number; // -1 until first placement
  assignedPitch: number | null; // sticky pitch for spectator convenience
}

/**
 * Generate the full group-stage schedule.
 *
 * @throws if pitchCount < 1 or any group has fewer than 2 teams.
 */
export function generateSchedule(input: ScheduleInput): ScheduleResult {
  const { pitchCount } = input;
  if (pitchCount < 1) throw new Error("pitchCount must be at least 1");

  const states: GroupState[] = input.groups.map((g) => {
    if (g.teamIds.length < 2) {
      throw new Error(`group ${g.groupId} needs at least 2 teams`);
    }
    const rounds = roundRobin(g.teamIds);
    return {
      groupId: g.groupId,
      rounds,
      roundIndex: 0,
      pending: rounds.length > 0 ? [...rounds[0]!] : [],
      lastPlacedSlot: -1,
      assignedPitch: null,
    };
  });

  const matches: ScheduledMatch[] = [];
  let slotIndex = 0;

  const hasWork = () =>
    states.some((s) => s.pending.length > 0 || s.roundIndex < s.rounds.length - 1);

  // Safety bound: total matches is finite; never loop forever.
  const totalMatches = states.reduce(
    (sum, s) => sum + s.rounds.reduce((a, r) => a + r.length, 0),
    0,
  );
  let guard = totalMatches + states.length * 2 + 1;

  while (hasWork() && guard-- > 0) {
    let capacity = pitchCount;
    const usedPitches = new Set<number>();
    // A group may contribute to this slot only if its current round has pending
    // matches AND it did not already place a match here this slot.
    const eligible = states
      .filter((s) => s.pending.length > 0 && s.lastPlacedSlot < slotIndex)
      // Waited longest first: maximise minimum rest under scarce capacity.
      .sort((a, b) => waited(b, slotIndex) - waited(a, slotIndex));

    for (const state of eligible) {
      if (capacity <= 0) break;
      const take = Math.min(state.pending.length, capacity);
      for (let i = 0; i < take; i++) {
        const [home, away] = state.pending.shift()!;
        const pitchIndex = pickPitch(state, usedPitches, pitchCount);
        usedPitches.add(pitchIndex);
        matches.push({
          groupId: state.groupId,
          homeTeamId: home,
          awayTeamId: away,
          round: state.roundIndex,
          slotIndex,
          pitchIndex,
        });
        capacity--;
      }
      state.lastPlacedSlot = slotIndex;
      // If the current round is fully placed, advance — but the next round must
      // wait for a later slot (the teams just played), so we stop touching this
      // group for the current slot.
      if (state.pending.length === 0 && state.roundIndex < state.rounds.length - 1) {
        state.roundIndex++;
        state.pending = [...state.rounds[state.roundIndex]!];
      }
    }
    slotIndex++;
  }

  return {
    slotCount: slotIndex,
    matches,
    restStats: computeRestStats(matches),
  };
}

function waited(state: GroupState, slotIndex: number): number {
  return state.lastPlacedSlot < 0 ? slotIndex + 1 : slotIndex - state.lastPlacedSlot;
}

/** Keep a group on its sticky pitch when free; otherwise take the lowest free pitch. */
function pickPitch(state: GroupState, used: Set<number>, pitchCount: number): number {
  if (state.assignedPitch !== null && !used.has(state.assignedPitch)) {
    return state.assignedPitch;
  }
  for (let p = 0; p < pitchCount; p++) {
    if (!used.has(p)) {
      if (state.assignedPitch === null) state.assignedPitch = p;
      return p;
    }
  }
  // Capacity is enforced by the caller, so a free pitch always exists.
  throw new Error("no free pitch in slot");
}

export function computeRestStats(matches: ScheduledMatch[]): RestStats {
  const teamSlots = new Map<string, number[]>();
  const add = (teamId: string, slot: number) => {
    const list = teamSlots.get(teamId) ?? [];
    list.push(slot);
    teamSlots.set(teamId, list);
  };
  for (const m of matches) {
    add(m.homeTeamId, m.slotIndex);
    add(m.awayTeamId, m.slotIndex);
  }

  const gaps: number[] = [];
  for (const slots of teamSlots.values()) {
    slots.sort((a, b) => a - b);
    for (let i = 1; i < slots.length; i++) {
      gaps.push(slots[i]! - slots[i - 1]!);
    }
  }

  if (gaps.length === 0) return { min: 0, max: 0, avg: 0 };
  const min = Math.min(...gaps);
  const max = Math.max(...gaps);
  const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  return { min, max, avg: Math.round(avg * 100) / 100 };
}
