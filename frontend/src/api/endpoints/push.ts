import { z } from "zod";
import { apiRequest } from "../client";

const PublicKeyResponse = z.object({
  enabled: z.boolean(),
  key: z.string().nullable(),
});

/** Whether the backend has VAPID keys at all, plus the key needed to subscribe. */
export function getPushPublicKey() {
  return apiRequest("/push/public-key", { schema: PublicKeyResponse });
}

export interface PushSubscriptionBody {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export function subscribePush(body: PushSubscriptionBody) {
  return apiRequest("/push/subscribe", { method: "POST", body });
}

export function unsubscribePush(endpoint: string) {
  return apiRequest("/push/unsubscribe", { method: "POST", body: { endpoint } });
}
