import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAdmin } from "../plugins/auth.js";
import { generateGroupSchedule } from "../services/scheduleService.js";
import { broadcaster } from "../sse/broadcaster.js";

const idParam = z.object({ id: z.string() });

export async function scheduleRoutes(app: FastifyInstance): Promise<void> {
  app.post("/tournaments/:id/schedule/generate", async (request) => {
    await requireAdmin(request);
    const { id } = idParam.parse(request.params);
    const result = await generateGroupSchedule(id);
    broadcaster.broadcast(id, "schedule.updated", { regenerated: true });
    return {
      slots: result.slotCount,
      matches: result.matchCount,
      restStats: result.restStats,
    };
  });
}
