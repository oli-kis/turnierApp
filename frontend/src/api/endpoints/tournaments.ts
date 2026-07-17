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

/**
 * Registration settings, editable only via PATCH — a tournament is created
 * without registration and opened for it later, once its categories exist.
 * `registrationDeadline: null` clears the deadline.
 */
export interface RegistrationSettings {
  entryFeeRp: number;
  registrationOpen: boolean;
  registrationDeadline: string | null;
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

export function updateTournament(
  id: string,
  patch: Partial<TournamentInput & RegistrationSettings>,
) {
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

const FinishRunningResponse = z.object({
  finished: z.array(z.string()),
  skipped: z.array(z.object({ matchId: z.string(), reason: z.string() })),
});
export type FinishRunningResult = z.infer<typeof FinishRunningResponse>;

export function finishRunningMatches(id: string) {
  return apiRequest(`/tournaments/${id}/matches/finish-running`, {
    method: "POST",
    schema: FinishRunningResponse,
  });
}

export function getSlots(id: string) {
  return apiRequest(`/tournaments/${id}/slots`, { schema: SlotsResponse });
}

export function getDashboard(id: string) {
  return apiRequest(`/tournaments/${id}/dashboard`, { schema: DashboardSchema });
}
