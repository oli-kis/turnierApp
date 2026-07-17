import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db/client.js";
import { requireAdmin } from "../plugins/auth.js";
import { cancelRegistration } from "../services/registrationService.js";
import { dashboardUrl } from "../services/stripeService.js";

const idParam = z.object({ id: z.string() });

const listQuery = z.object({
  status: z.enum(["PENDING_PAYMENT", "PAID", "EXPIRED", "CANCELED"]).optional(),
});

export async function adminRegistrationRoutes(app: FastifyInstance): Promise<void> {
  /** Admin list — the one place contact data is exposed, hence admin-only. */
  app.get("/tournaments/:id/registrations", async (request) => {
    await requireAdmin(request);
    const { id } = idParam.parse(request.params);
    const q = listQuery.parse(request.query);

    const registrations = await prisma.registration.findMany({
      where: { tournamentId: id, ...(q.status ? { status: q.status } : {}) },
      include: { category: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
    });

    return {
      registrations: registrations.map((r) => ({
        id: r.id,
        teamName: r.teamName,
        contactName: r.contactName,
        contactEmail: r.contactEmail,
        contactPhone: r.contactPhone,
        status: r.status,
        amountRp: r.amountRp,
        categoryId: r.categoryId,
        categoryName: r.category.name,
        teamId: r.teamId,
        createdAt: r.createdAt,
        paidAt: r.paidAt,
        expiresAt: r.expiresAt,
        // Refunds are manual in v1, so the admin needs to land on the payment.
        stripeUrl: dashboardUrl(r.stripeSessionId),
      })),
    };
  });

  /**
   * Cancel a paid registration and delete its team. The money is *not* refunded
   * here — that is done by hand in the Stripe dashboard (v1), and the UI says so.
   */
  app.post("/registrations/:id/cancel", async (request) => {
    await requireAdmin(request);
    const { id } = idParam.parse(request.params);
    await cancelRegistration(id);
    return { status: "CANCELED" };
  });
}
