import fastifyJwt from "@fastify/jwt";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { prisma } from "../db/client.js";
import { env } from "../lib/env.js";
import { Errors } from "../lib/errors.js";

export interface JwtPayload {
  userId: string;
  role: "ADMIN" | "REFEREE";
}

// Augment @fastify/jwt so request.user is strongly typed.
declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: JwtPayload;
    user: JwtPayload;
  }
}

/** Register JWT support. Access tokens live 12h — one tournament day. */
export async function registerAuth(app: FastifyInstance): Promise<void> {
  await app.register(fastifyJwt, {
    secret: env.JWT_SECRET,
    sign: { expiresIn: "12h" },
  });
}

/** Verify the bearer token and populate request.user, or 401. */
export async function requireAuth(request: FastifyRequest): Promise<JwtPayload> {
  try {
    await request.jwtVerify();
  } catch {
    throw Errors.unauthorized("Invalid or missing token");
  }
  return request.user;
}

export async function requireAdmin(request: FastifyRequest): Promise<JwtPayload> {
  const user = await requireAuth(request);
  if (user.role !== "ADMIN") throw Errors.forbidden("Admin only");
  return user;
}

/** Approved referee (re-checks status in the DB in case approval was revoked). */
export async function requireApprovedReferee(
  request: FastifyRequest,
): Promise<JwtPayload> {
  const user = await requireAuth(request);
  if (user.role !== "REFEREE") throw Errors.forbidden("Referee only");
  const record = await prisma.user.findUnique({ where: { id: user.userId } });
  if (!record || record.status !== "APPROVED") {
    throw Errors.forbidden("Referee not approved");
  }
  return user;
}

/** Admin or approved referee — used by endpoints both may call. */
export async function requireAdminOrReferee(
  request: FastifyRequest,
): Promise<JwtPayload> {
  const user = await requireAuth(request);
  if (user.role === "ADMIN") return user;
  return requireApprovedReferee(request);
}
