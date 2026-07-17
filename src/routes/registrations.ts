import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createRegistration, publicStatus } from "../services/registrationService.js";

const idParam = z.object({ id: z.string() });

const createSchema = z.object({
  tournamentId: z.string().min(1),
  categoryId: z.string().min(1),
  teamName: z.string().trim().min(2).max(40),
  contactName: z.string().trim().min(1).max(80),
  contactEmail: z.string().trim().email(),
  contactPhone: z.string().trim().min(1).max(40),
});

export async function registrationRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Public, and it creates a payable session — so it is rate-limited. Without
   * this, anyone could mint Stripe sessions in a loop and park every team name
   * in a category behind a 30-minute hold.
   *
   * 20 per 10 minutes, keyed by IP. Deliberately not tighter: phones share
   * carrier-grade NAT and a whole club can sit behind one router, so several
   * unrelated registrations legitimately arrive from one address. A real human
   * filling this form and paying by TWINT needs minutes per team; a squatter
   * needs one request per name, and this caps them at ~2/min.
   */
  app.post(
    "/registrations",
    { config: { rateLimit: { max: 20, timeWindow: "10 minutes" } } },
    async (request, reply) => {
      const body = createSchema.parse(request.body);
      const result = await createRegistration(body);
      return reply.status(201).send(result);
    },
  );

  /**
   * Public status for the success page.
   *
   * The id travels in a URL the payer may well share or paste, so this returns
   * the minimum needed to render "you're in" — never the contact data.
   */
  app.get("/registrations/:id/status", async (request) => {
    const { id } = idParam.parse(request.params);
    return publicStatus(id);
  });
}
