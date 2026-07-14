import { z } from "zod";
import { apiRequest } from "../client";
import { StandingsSchema, BracketSchema, TeamSearchResultSchema, TeamMatchSchema } from "../types";

const TeamSearchResponse = z.object({ teams: z.array(TeamSearchResultSchema) });
const TeamMatchesResponse = z.object({ matches: z.array(TeamMatchSchema) });

export function getStandings(groupId: string) {
  return apiRequest(`/groups/${groupId}/standings`, { schema: StandingsSchema });
}

export function getBracket(categoryId: string) {
  return apiRequest(`/categories/${categoryId}/bracket`, { schema: BracketSchema });
}

export function searchTeams(tournamentId: string, q: string) {
  return apiRequest(`/tournaments/${tournamentId}/teams/search`, {
    query: { q },
    schema: TeamSearchResponse,
  });
}

export function getTeamMatches(teamId: string) {
  return apiRequest(`/teams/${teamId}/matches`, { schema: TeamMatchesResponse });
}
