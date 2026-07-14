import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db/client.js";
import { Errors } from "../lib/errors.js";
import { requireAdmin } from "../plugins/auth.js";

const listQuery = z.object({
  status: z.enum(["APPROVED", "PENDING", "REJECTED"]).optional(),
});

function refereeView(u: {
  id: string;
  email: string;
  name: string;
  status: string;
  createdAt: Date;
}) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    status: u.status,
    createdAt: u.createdAt,
  };
}

export async function adminRefereeRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/referees", async (request) => {
    await requireAdmin(request);
    const { status } = listQuery.parse(request.query);
    const referees = await prisma.user.findMany({
      where: { role: "REFEREE", ...(status ? { status } : {}) },
      orderBy: { createdAt: "asc" },
    });
    return { referees: referees.map(refereeView) };
  });

  app.post("/admin/referees/:id/approve", async (request) => {
    await requireAdmin(request);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const ref = await prisma.user.findUnique({ where: { id } });
    if (!ref || ref.role !== "REFEREE") throw Errors.notFound("Referee");
    if (ref.status !== "PENDING") {
      throw Errors.conflict("INVALID_STATUS", "Only PENDING referees can be approved");
    }
    const updated = await prisma.user.update({
      where: { id },
      data: { status: "APPROVED" },
    });
    return { referee: refereeView(updated) };
  });

  app.post("/admin/referees/:id/reject", async (request) => {
    await requireAdmin(request);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const ref = await prisma.user.findUnique({ where: { id } });
    if (!ref || ref.role !== "REFEREE") throw Errors.notFound("Referee");
    if (ref.status !== "PENDING") {
      throw Errors.conflict("INVALID_STATUS", "Only PENDING referees can be rejected");
    }
    const updated = await prisma.user.update({
      where: { id },
      data: { status: "REJECTED" },
    });
    return { referee: refereeView(updated) };
  });
}
