import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db/client.js";
import { requireApprovedReferee } from "../plugins/auth.js";
import { isPushEnabled, publicKey } from "../services/pushService.js";

const subscriptionBody = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});

export async function pushRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Whether push is configured at all, plus the key the client needs to
   * subscribe. Public: the client has to know before it can decide whether to
   * offer the toggle, and the VAPID *public* key is public by construction.
   */
  app.get("/push/public-key", async () => ({
    enabled: isPushEnabled(),
    key: publicKey(),
  }));

  // Register this device for the calling referee.
  app.post("/push/subscribe", async (request, reply) => {
    const user = await requireApprovedReferee(request);
    const body = subscriptionBody.parse(request.body);

    // Upsert on the endpoint, not on (userId, endpoint): a shared or handed-down
    // phone re-subscribing under a new login must move to the new referee rather
    // than keep notifying the previous one.
    await prisma.pushSubscription.upsert({
      where: { endpoint: body.endpoint },
      create: {
        userId: user.userId,
        endpoint: body.endpoint,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
      },
      update: {
        userId: user.userId,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
      },
    });

    return reply.status(201).send({ subscribed: true });
  });

  // Unregister this device. Idempotent: unsubscribing twice is success, since
  // the caller's intent — "this endpoint should not be notified" — is satisfied.
  app.post("/push/unsubscribe", async (request) => {
    await requireApprovedReferee(request);
    const { endpoint } = z.object({ endpoint: z.string().url() }).parse(request.body);
    await prisma.pushSubscription.deleteMany({ where: { endpoint } });
    return { subscribed: false };
  });
}
