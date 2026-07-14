/**
 * Group standings — pure, computed on read from finished group matches.
 *
 * Tiebreakers, in order (CLAUDE.md):
 *   points -> goal difference -> goals scored -> head-to-head result ->
 *   head-to-head goal difference.
 *
 * Head-to-head is evaluated only among the currently-tied subset of teams: a
 * mini-league of the matches those teams played against each other.
 *
 * If a fully-tied group of teams remains and it straddles the qualification cut,
 * `tieUnresolved` is set so the admin can resolve it by drawing lots. A manual
 * order (from a prior draw) overrides everything.
 */

export interface TeamRef {
  id: string;
  name: string;
}

export interface FinishedGroupMatch {
  homeTeamId: string;
  awayTeamId: string;
  scoreHome: number;
  scoreAway: number;
}

export interface StandingRow {
  teamId: string;
  name: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  rank: number;
}

export interface StandingsResult {
  rows: StandingRow[];
  tieUnresolved: boolean;
}

export interface StandingsOptions {
  /** Teams advancing from this group; enables straddle-aware tie flagging. */
  qualifiersPerGroup?: number;
  /** Definitive order from a manual draw of lots; overrides tiebreakers. */
  manualOrder?: string[];
}

interface Stat {
  teamId: string;
  name: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
}

function goalDiff(s: Stat): number {
  return s.goalsFor - s.goalsAgainst;
}

export function computeStandings(
  teams: TeamRef[],
  matches: FinishedGroupMatch[],
  options: StandingsOptions = {},
): StandingsResult {
  const stats = new Map<string, Stat>();
  for (const t of teams) {
    stats.set(t.id, {
      teamId: t.id,
      name: t.name,
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      points: 0,
    });
  }

  for (const m of matches) {
    const home = stats.get(m.homeTeamId);
    const away = stats.get(m.awayTeamId);
    if (!home || !away) continue; // ignore matches with teams outside this group
    home.played++;
    away.played++;
    home.goalsFor += m.scoreHome;
    home.goalsAgainst += m.scoreAway;
    away.goalsFor += m.scoreAway;
    away.goalsAgainst += m.scoreHome;
    if (m.scoreHome > m.scoreAway) {
      home.won++;
      away.lost++;
      home.points += 3;
    } else if (m.scoreHome < m.scoreAway) {
      away.won++;
      home.lost++;
      away.points += 3;
    } else {
      home.drawn++;
      away.drawn++;
      home.points += 1;
      away.points += 1;
    }
  }

  const allStats = teams.map((t) => stats.get(t.id)!);

  // Manual order from a draw of lots is definitive.
  if (options.manualOrder && options.manualOrder.length > 0) {
    const orderIndex = new Map(options.manualOrder.map((id, i) => [id, i]));
    const sorted = [...allStats].sort(
      (a, b) => (orderIndex.get(a.teamId) ?? 1e9) - (orderIndex.get(b.teamId) ?? 1e9),
    );
    return { rows: toRows(sorted), tieUnresolved: false };
  }

  // Primary sort: points, then goal difference, then goals scored.
  const primarySorted = [...allStats].sort(comparePrimary);

  // Break primary ties with a head-to-head mini-league, and flag any remaining
  // fully-tied subset that straddles the qualification cut.
  const ordered: Stat[] = [];
  let tieUnresolved = false;
  let i = 0;
  while (i < primarySorted.length) {
    let j = i + 1;
    while (j < primarySorted.length && primaryEqual(primarySorted[i]!, primarySorted[j]!)) {
      j++;
    }
    const tier = primarySorted.slice(i, j);
    if (tier.length === 1) {
      ordered.push(tier[0]!);
    } else {
      const tierStart = ordered.length; // 0-based rank of the tier's top member
      const { resolved, unresolvedGroups } = resolveHeadToHead(tier, matches);
      ordered.push(...resolved);
      for (const grp of unresolvedGroups) {
        const offset = resolved.findIndex((s) => s.teamId === grp[0]!.teamId);
        if (straddlesCut(tierStart + offset, grp, options.qualifiersPerGroup)) {
          tieUnresolved = true;
        }
      }
    }
    i = j;
  }

  return { rows: toRows(ordered), tieUnresolved };
}

function comparePrimary(a: Stat, b: Stat): number {
  if (b.points !== a.points) return b.points - a.points;
  if (goalDiff(b) !== goalDiff(a)) return goalDiff(b) - goalDiff(a);
  return b.goalsFor - a.goalsFor;
}

function primaryEqual(a: Stat, b: Stat): boolean {
  return a.points === b.points && goalDiff(a) === goalDiff(b) && a.goalsFor === b.goalsFor;
}

/**
 * Order a primary-tied tier by head-to-head. Returns the ordered tier plus any
 * sub-groups that stayed fully equal even after head-to-head (candidates for a
 * lot-drawing).
 */
function resolveHeadToHead(
  tier: Stat[],
  matches: FinishedGroupMatch[],
): { resolved: Stat[]; unresolvedGroups: Stat[][] } {
  const ids = new Set(tier.map((t) => t.teamId));
  const h2h = new Map<string, { points: number; gd: number }>();
  for (const t of tier) h2h.set(t.teamId, { points: 0, gd: 0 });

  for (const m of matches) {
    if (!ids.has(m.homeTeamId) || !ids.has(m.awayTeamId)) continue;
    const home = h2h.get(m.homeTeamId)!;
    const away = h2h.get(m.awayTeamId)!;
    home.gd += m.scoreHome - m.scoreAway;
    away.gd += m.scoreAway - m.scoreHome;
    if (m.scoreHome > m.scoreAway) home.points += 3;
    else if (m.scoreHome < m.scoreAway) away.points += 3;
    else {
      home.points += 1;
      away.points += 1;
    }
  }

  const sorted = [...tier].sort((a, b) => {
    const ha = h2h.get(a.teamId)!;
    const hb = h2h.get(b.teamId)!;
    if (hb.points !== ha.points) return hb.points - ha.points;
    return hb.gd - ha.gd;
  });

  // Detect sub-groups still equal on head-to-head points and gd.
  const unresolvedGroups: Stat[][] = [];
  let k = 0;
  while (k < sorted.length) {
    let l = k + 1;
    const hk = h2h.get(sorted[k]!.teamId)!;
    while (l < sorted.length) {
      const hl = h2h.get(sorted[l]!.teamId)!;
      if (hl.points === hk.points && hl.gd === hk.gd) l++;
      else break;
    }
    if (l - k > 1) unresolvedGroups.push(sorted.slice(k, l));
    k = l;
  }

  return { resolved: sorted, unresolvedGroups };
}

/**
 * Whether a fully-tied group crosses the qualification boundary. Without a
 * qualifiers count we conservatively flag any remaining full tie.
 */
function straddlesCut(
  groupStartRank: number,
  group: Stat[],
  qualifiersPerGroup?: number,
): boolean {
  if (qualifiersPerGroup === undefined) return true;
  const firstRank = groupStartRank; // 0-based rank of the group's top member
  const lastRank = groupStartRank + group.length - 1;
  const cut = qualifiersPerGroup - 1; // last qualifying 0-based rank
  return firstRank <= cut && lastRank > cut;
}

function toRows(sorted: Stat[]): StandingRow[] {
  return sorted.map((s, idx) => ({
    teamId: s.teamId,
    name: s.name,
    played: s.played,
    won: s.won,
    drawn: s.drawn,
    lost: s.lost,
    goalsFor: s.goalsFor,
    goalsAgainst: s.goalsAgainst,
    goalDifference: goalDiff(s),
    points: s.points,
    rank: idx + 1,
  }));
}
