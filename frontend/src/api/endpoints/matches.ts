import { z } from "zod";
import { apiRequest } from "../client";
import { MatchListItemSchema, MatchDetailSchema } from "../types";

const MatchesResponse = z.object({ matches: z.array(MatchListItemSchema) });
const MatchResponse = z.object({ match: MatchDetailSchema });

export interface MatchFilters {
  categoryId?: string;
  groupId?: string;
  phase?: string;
  teamId?: string;
  status?: string;
}

export function listMatches(tournamentId: string, filters: MatchFilters = {}) {
  return apiRequest(`/tournaments/${tournamentId}/matches`, {
    query: filters as Record<string, string | undefined>,
    schema: MatchesResponse,
  });
}

export function getMatch(id: string) {
  return apiRequest(`/matches/${id}`, { schema: MatchResponse });
}

export function updateMatch(
  id: string,
  body: { pitchId?: string | null; slotId?: string | null; refereeId?: string | null },
) {
  return apiRequest(`/matches/${id}`, { method: "PATCH", body, schema: MatchResponse });
}

export function correctResult(
  id: string,
  body: { scoreHome: number; scoreAway: number; pensHome?: number | null; pensAway?: number | null },
) {
  return apiRequest(`/matches/${id}/result`, { method: "PATCH", body });
}

export function forceReady(id: string) {
  return apiRequest(`/matches/${id}/force-ready`, { method: "POST" });
}
