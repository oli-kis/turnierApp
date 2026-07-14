import { useQuery } from "@tanstack/react-query";
import * as auth from "./endpoints/auth";
import * as tournaments from "./endpoints/tournaments";
import * as matches from "./endpoints/matches";
import * as referee from "./endpoints/referee";
import * as admin from "./endpoints/admin";
import * as pub from "./endpoints/public";
import type { MatchFilters } from "./endpoints/matches";
import { getToken } from "./client";

/**
 * Query keys live ONLY here. sse.ts and mutations import these so invalidation
 * always targets the same key shape.
 */
export const qk = {
  me: () => ["me"] as const,
  tournaments: () => ["tournaments"] as const,
  tournament: (id: string) => ["tournament", id] as const,
  slots: (id: string) => ["slots", id] as const,
  dashboard: (id: string) => ["dashboard", id] as const,
  matches: (id: string, filters?: MatchFilters) => ["matches", id, filters ?? {}] as const,
  matchLists: (id: string) => ["matches", id] as const,
  match: (id: string) => ["match", id] as const,
  standings: (groupId: string) => ["standings", groupId] as const,
  bracket: (categoryId: string) => ["bracket", categoryId] as const,
  teamSearch: (id: string, q: string) => ["teamSearch", id, q] as const,
  teamMatches: (teamId: string) => ["teamMatches", teamId] as const,
  myMatches: () => ["myMatches"] as const,
  referees: (status?: string) => ["referees", status ?? "ALL"] as const,
};

export function useMe() {
  return useQuery({
    queryKey: qk.me(),
    queryFn: () => auth.getMe().then((r) => r.user),
    enabled: !!getToken(),
    staleTime: Infinity,
  });
}

export function useTournaments() {
  return useQuery({
    queryKey: qk.tournaments(),
    queryFn: () => tournaments.listTournaments().then((r) => r.tournaments),
  });
}

export function useTournament(id: string | undefined) {
  return useQuery({
    queryKey: qk.tournament(id ?? ""),
    queryFn: () => tournaments.getTournament(id!).then((r) => r.tournament),
    enabled: !!id,
  });
}

export function useSlots(id: string | undefined) {
  return useQuery({
    queryKey: qk.slots(id ?? ""),
    queryFn: () => tournaments.getSlots(id!).then((r) => r.slots),
    enabled: !!id,
  });
}

export function useDashboard(id: string | undefined) {
  return useQuery({
    queryKey: qk.dashboard(id ?? ""),
    queryFn: () => tournaments.getDashboard(id!),
    enabled: !!id,
  });
}

export function useMatches(id: string | undefined, filters: MatchFilters = {}) {
  return useQuery({
    queryKey: qk.matches(id ?? "", filters),
    queryFn: () => matches.listMatches(id!, filters).then((r) => r.matches),
    enabled: !!id,
  });
}

export function useMatch(id: string | undefined) {
  return useQuery({
    queryKey: qk.match(id ?? ""),
    queryFn: () => matches.getMatch(id!).then((r) => r.match),
    enabled: !!id,
  });
}

export function useStandings(groupId: string | undefined) {
  return useQuery({
    queryKey: qk.standings(groupId ?? ""),
    queryFn: () => pub.getStandings(groupId!),
    enabled: !!groupId,
  });
}

export function useBracket(categoryId: string | undefined) {
  return useQuery({
    queryKey: qk.bracket(categoryId ?? ""),
    queryFn: () => pub.getBracket(categoryId!),
    enabled: !!categoryId,
    retry: false, // bracket may 404 before generation; handled by the screen
  });
}

export function useTeamSearch(tournamentId: string | undefined, q: string) {
  return useQuery({
    queryKey: qk.teamSearch(tournamentId ?? "", q),
    queryFn: () => pub.searchTeams(tournamentId!, q).then((r) => r.teams),
    enabled: !!tournamentId,
    placeholderData: (prev) => prev,
  });
}

export function useTeamMatches(teamId: string | undefined) {
  return useQuery({
    queryKey: qk.teamMatches(teamId ?? ""),
    queryFn: () => pub.getTeamMatches(teamId!).then((r) => r.matches),
    enabled: !!teamId,
  });
}

export function useMyMatches() {
  return useQuery({
    queryKey: qk.myMatches(),
    queryFn: () => referee.getMyMatches().then((r) => r.matches),
    // The referee home has no SSE mounted; poll so slot state stays fresh.
    refetchInterval: 15_000,
  });
}

export function useReferees(status?: "APPROVED" | "PENDING" | "REJECTED") {
  return useQuery({
    queryKey: qk.referees(status),
    queryFn: () => admin.listReferees(status).then((r) => r.referees),
  });
}
