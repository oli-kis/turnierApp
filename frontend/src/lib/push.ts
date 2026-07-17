import { getPushPublicKey, subscribePush, unsubscribePush } from "../api/endpoints/push";

/**
 * Web Push enrolment for referees.
 *
 * Kept out of the component because the platform rules here are fiddly and worth
 * stating once:
 *
 * - **iOS only supports push in an installed PWA.** Safari exposes no PushManager
 *   in a normal tab, so roughly half the referees can only get this after adding
 *   the app to the home screen. `pushSupport()` distinguishes "your phone can't"
 *   from "install it first", because those need different answers from the UI.
 * - **The browser subscription and our database can disagree.** The user can
 *   revoke permission in system settings, and the browser can drop a
 *   subscription on its own. The browser is always the authority; our row is a
 *   cache of it.
 */

/** Push is available but requires the PWA to be installed first (iOS Safari). */
export type PushSupport = "ready" | "needs-install" | "unsupported";

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS Safari's own, non-standard flag for a home-screen app.
    ("standalone" in navigator && (navigator as { standalone?: boolean }).standalone === true)
  );
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export function pushSupport(): PushSupport {
  if ("serviceWorker" in navigator && "PushManager" in window && "Notification" in window) {
    return "ready";
  }
  // On iOS the APIs appear only once the app runs from the home screen, so an
  // uninstalled iPhone is "not yet", not "never".
  if (isIos() && !isStandalone()) return "needs-install";
  return "unsupported";
}

/**
 * VAPID keys travel as base64url; PushManager wants raw bytes.
 *
 * The buffer is allocated explicitly so the result is a `Uint8Array<ArrayBuffer>`
 * rather than the `ArrayBufferLike` that `Uint8Array.from` infers — `subscribe`
 * accepts only the former, since a SharedArrayBuffer cannot be a BufferSource.
 */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  // `ready` never rejects but can hang forever if no worker is registered —
  // which is the normal case in `npm run dev`, where the SW is disabled.
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
  ]);
}

/** The browser's current subscription, or null. The browser is the authority. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await registration();
  if (!reg) return null;
  return reg.pushManager.getSubscription();
}

export type SubscribeResult = "subscribed" | "denied" | "unavailable";

/**
 * Ask for permission, subscribe, and register the endpoint with the backend.
 *
 * Must be called from a user gesture: browsers reject a permission prompt that
 * no one asked for, and — more to the point — so do referees.
 */
export async function enablePush(): Promise<SubscribeResult> {
  const reg = await registration();
  if (!reg) return "unavailable";

  const { enabled, key } = await getPushPublicKey();
  if (!enabled || !key) return "unavailable";

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return "denied";

  // Reuse the existing browser subscription when there is one: re-subscribing
  // would mint a new endpoint and orphan the row we already have.
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key),
    }));

  const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) return "unavailable";

  await subscribePush({
    endpoint: json.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
  });
  return "subscribed";
}

/**
 * Unsubscribe here and on the backend.
 *
 * The backend is told first: if that succeeds and the browser call fails, the
 * referee stops being notified, which is what they asked for. The other order
 * could leave a dead row buzzing a phone that has no way to turn it off.
 */
export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await unsubscribePush(sub.endpoint);
  await sub.unsubscribe();
}
