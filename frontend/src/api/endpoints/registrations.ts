import { z } from "zod";
import { apiRequest } from "../client";
import { RegistrationPublicStatusSchema, RegistrationSchema } from "../types";

export interface RegistrationInput {
  tournamentId: string;
  categoryId: string;
  teamName: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
}

const CreateResponse = z.object({
  registrationId: z.string(),
  checkoutUrl: z.string(),
});

/** Public. Returns the Stripe Checkout URL to redirect to. */
export function createRegistration(input: RegistrationInput) {
  return apiRequest("/registrations", { method: "POST", body: input, schema: CreateResponse });
}

/** Public. Polled by the success page until the webhook has landed. */
export function getRegistrationStatus(id: string) {
  return apiRequest(`/registrations/${id}/status`, { schema: RegistrationPublicStatusSchema });
}

const ListResponse = z.object({ registrations: z.array(RegistrationSchema) });

/** Admin only — includes contact data. */
export function listRegistrations(tournamentId: string, status?: string) {
  const q = status ? `?status=${encodeURIComponent(status)}` : "";
  return apiRequest(`/tournaments/${tournamentId}/registrations${q}`, { schema: ListResponse });
}

export function cancelRegistration(id: string) {
  return apiRequest(`/registrations/${id}/cancel`, { method: "POST" });
}
