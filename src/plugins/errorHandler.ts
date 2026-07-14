import type { FastifyInstance, FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { AppError } from "../lib/errors.js";

/** Global error handler: everything leaves as `{ error: { code, message } }`. */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler(
    (error: FastifyError, _request: FastifyRequest, reply: FastifyReply) => {
      if (error instanceof AppError) {
        return reply
          .status(error.statusCode)
          .send({ error: { code: error.code, message: error.message } });
      }

      if (error instanceof ZodError) {
        const first = error.issues[0];
        const message = first
          ? `${first.path.join(".") || "body"}: ${first.message}`
          : "Validation failed";
        return reply
          .status(400)
          .send({ error: { code: "VALIDATION_ERROR", message } });
      }

      // Fastify's own rate-limit / validation errors carry a statusCode.
      if (error.statusCode === 429) {
        return reply
          .status(429)
          .send({ error: { code: "RATE_LIMITED", message: "Too many requests" } });
      }
      if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
        return reply.status(error.statusCode).send({
          error: { code: error.code ?? "BAD_REQUEST", message: error.message },
        });
      }

      app.log.error(error);
      return reply
        .status(500)
        .send({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
    },
  );

  app.setNotFoundHandler((_request, reply) => {
    reply
      .status(404)
      .send({ error: { code: "NOT_FOUND", message: "Route not found" } });
  });
}
