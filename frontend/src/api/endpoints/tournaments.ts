import { z } from "zod";
import { apiRequest } from "../client";
import {
  TournamentSchema,
  TournamentDetailSchema,
  SlotSchema,
  DashboardSchema,
} from "../types";

const TournamentsResponse = z.object({ tournaments: z.array(TournamentSchema) });
const TournamentResponse = z.object({ tournament: TournamentDetailSchema });
const SlotsResponse = z.object({ slots: z.array(SlotSchema) });

export interface TournamentInput {
  name: string;
  startAt: string;
  matchDurationMin: number;
  transitionMin: number;
  pitchCount: number;
}

export function listTournaments() {
  return apiRequest("/tournaments", { schema: TournamentsResponse });
}

export function getTournament(id: string) {
  return apiRequest(`/tournaments/${id}`, { schema: TournamentResponse });
}

export function createTournament(input: TournamentInput) {
  return apiRequest("/tournaments", {
    method: "POST",
    body: input,
    schema: TournamentResponse,
  });
}

export function updateTournament(id: string, patch: Partial<TournamentInput>) {
  return apiRequest(`/tournaments/${id}`, {
    method: "PATCH",
    body: patch,
    schema: TournamentResponse,
  });
}

export function deleteTournament(id: string) {
  return apiRequest<void>(`/tournaments/${id}`, { method: "DELETE" });
}

export function startTournament(id: string) {
  return apiRequest(`/tournaments/${id}/start`, { method: "POST" });
}

export function finishTournament(id: string) {
  return apiRequest(`/tournaments/${id}/finish`, { method: "POST" });
}

export function getSlots(id: string) {
  return apiRequest(`/tournaments/${id}/slots`, { schema: SlotsResponse });
}

export function getDashboard(id: string) {
  return apiRequest(`/tournaments/${id}/dashboard`, { schema: DashboardSchema });
}
