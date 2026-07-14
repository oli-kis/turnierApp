import { z } from "zod";
import { apiRequest } from "../client";
import { RefereeMatchSchema } from "../types";

const RefereeMatchesResponse = z.object({ matches: z.array(RefereeMatchSchema) });

export function getMyMatches() {
  return apiRequest("/referees/me/matches", { schema: RefereeMatchesResponse });
}

export function ready(matchId: string) {
  return apiRequest(`/matches/${matchId}/ready`, { method: "POST" });
}

export function unready(matchId: string) {
  return apiRequest(`/matches/${matchId}/unready`, { method: "POST" });
}

export function addGoal(matchId: string, teamId: string) {
  return apiRequest(`/matches/${matchId}/goals`, {
    method: "POST",
    body: { teamId },
    schema: z.object({ goalId: z.string() }),
  });
}

export function deleteGoal(goalId: string) {
  return apiRequest<void>(`/goals/${goalId}`, { method: "DELETE" });
}

export function finishMatch(matchId: string) {
  return apiRequest(`/matches/${matchId}/finish`, { method: "POST" });
}

export function submitPenalties(matchId: string, home: number, away: number) {
  return apiRequest(`/matches/${matchId}/penalties`, {
    method: "POST",
    body: { home, away },
  });
}
