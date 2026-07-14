import { z } from "zod";
import { apiRequest } from "../client";
import { CategorySchema, GroupSchema, TeamSchema, RestStatsSchema } from "../types";

const CategoryResponse = z.object({ category: CategorySchema });
const GroupResponse = z.object({ group: GroupSchema });
const TeamResponse = z.object({ team: TeamSchema });

// ---- Categories ----
export function createCategory(
  tournamentId: string,
  body: { name: string; qualifiersPerGroup?: number | null },
) {
  return apiRequest(`/tournaments/${tournamentId}/categories`, {
    method: "POST",
    body,
    schema: CategoryResponse,
  });
}

export function updateCategory(
  id: string,
  body: { name?: string; qualifiersPerGroup?: number | null },
) {
  return apiRequest(`/categories/${id}`, { method: "PATCH", body, schema: CategoryResponse });
}

export function deleteCategory(id: string) {
  return apiRequest<void>(`/categories/${id}`, { method: "DELETE" });
}

// ---- Groups ----
export function createGroup(categoryId: string, name: string) {
  return apiRequest(`/categories/${categoryId}/groups`, {
    method: "POST",
    body: { name },
    schema: GroupResponse,
  });
}

export function updateGroup(id: string, name: string) {
  return apiRequest(`/groups/${id}`, { method: "PATCH", body: { name }, schema: GroupResponse });
}

export function deleteGroup(id: string) {
  return apiRequest<void>(`/groups/${id}`, { method: "DELETE" });
}

export function setTiebreak(groupId: string, order: string[]) {
  return apiRequest(`/groups/${groupId}/tiebreak`, {
    method: "PATCH",
    body: { order },
    schema: z.object({ groupId: z.string(), order: z.array(z.string()) }),
  });
}

// ---- Teams ----
export function createTeam(groupId: string, name: string) {
  return apiRequest(`/groups/${groupId}/teams`, {
    method: "POST",
    body: { name },
    schema: TeamResponse,
  });
}

export function updateTeam(id: string, body: { name?: string; groupId?: string }) {
  return apiRequest(`/teams/${id}`, { method: "PATCH", body, schema: TeamResponse });
}

export function deleteTeam(id: string) {
  return apiRequest<void>(`/teams/${id}`, { method: "DELETE" });
}

// ---- Schedule / knockout generation ----
export function generateSchedule(tournamentId: string) {
  return apiRequest(`/tournaments/${tournamentId}/schedule/generate`, {
    method: "POST",
    schema: z.object({
      slots: z.number(),
      matches: z.number(),
      restStats: RestStatsSchema,
    }),
  });
}

export function generateKnockout(categoryId: string) {
  return apiRequest(`/categories/${categoryId}/knockout/generate`, {
    method: "POST",
    schema: z.object({
      bracketSize: z.number(),
      matches: z.number(),
      seeds: z.array(z.string()),
    }),
  });
}
