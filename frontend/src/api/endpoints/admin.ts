import { z } from "zod";
import { apiRequest } from "../client";
import { RefereeSchema } from "../types";

const RefereesResponse = z.object({ referees: z.array(RefereeSchema) });

export function listReferees(status?: "APPROVED" | "PENDING" | "REJECTED") {
  return apiRequest("/admin/referees", {
    query: { status },
    schema: RefereesResponse,
  });
}

export function approveReferee(id: string) {
  return apiRequest(`/admin/referees/${id}/approve`, { method: "POST" });
}

export function rejectReferee(id: string) {
  return apiRequest(`/admin/referees/${id}/reject`, { method: "POST" });
}

export function deleteReferee(id: string) {
  return apiRequest<void>(`/admin/referees/${id}`, { method: "DELETE" });
}
