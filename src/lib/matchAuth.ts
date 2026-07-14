import type { FastifyRequest } from "fastify";
import type { Match } from "@prisma/client";
import { Errors } from "./errors.js";
import { requireApprovedReferee, requireAdminOrReferee } from "../plugins/auth.js";

/** The approved referee assigned to this match (rejects admins and others). */
export async function requireAssignedReferee(
  request: FastifyRequest,
  match: Match,
): Promise<void> {
  const user = await requireApprovedReferee(request);
  if (match.refereeId !== user.userId) {
    throw Errors.forbidden("You are not assigned to this match");
  }
}

/** Admin, or the approved referee assigned to this match. */
export async function requireAssignedRefereeOrAdmin(
  request: FastifyRequest,
  match: Match,
): Promise<{ isAdmin: boolean; userId: string }> {
  const user = await requireAdminOrReferee(request);
  if (user.role === "ADMIN") return { isAdmin: true, userId: user.userId };
  if (match.refereeId !== user.userId) {
    throw Errors.forbidden("You are not assigned to this match");
  }
  return { isAdmin: false, userId: user.userId };
}
