import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getTournamentOr404 } from "../lib/loaders.js";
import { broadcaster } from "../sse/broadcaster.js";

const idParam = z.object({ id: z.string() });

/** Public one-directional SSE stream for a tournament. */
export async function eventRoutes(app: FastifyInstance): Promise<void> {
  app.get("/tournaments/:id/events", async (request, reply) => {
    const { id } = idParam.parse(request.params);
    await getTournamentOr404(id);

    // Take over the socket; Fastify will not send its own response.
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    reply.raw.write(`retry: 3000\n\n`);
    reply.raw.write(`event: connected\ndata: ${JSON.stringify({ tournamentId: id })}\n\n`);

    const unsubscribe = broadcaster.subscribe(id, reply);
    const heartbeat = setInterval(() => broadcaster.heartbeat(id), 25_000);

    request.raw.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });
}
