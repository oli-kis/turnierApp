/// <reference lib="webworker" />
import { precacheAndRoute, createHandlerBoundToURL, cleanupOutdatedCaches } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";

/**
 * The service worker.
 *
 * Hand-written (`injectManifest`) rather than generated, because push needs real
 * listeners and workbox cannot generate those. Everything the generated worker
 * used to do is restated here on purpose — the caching contract below is a
 * deliberate product decision, not a default, and it must stay readable.
 */

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

/* ----------------------------------------------------------------- caching */

// App shell and fonts, injected at build time by vite-plugin-pwa.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

/**
 * SPA navigations fall back to the precached shell — except under `/api`, which
 * must never be swallowed by an HTML fallback: it carries the REST endpoints and
 * the SSE stream.
 *
 * There is deliberately NO runtime caching for `/api`. Everything under it is
 * live tournament data, and a cached standings table or score on tournament day
 * is worse than no answer at all. Requests that aren't matched by a route here
 * go straight to the network, which is exactly the intent — offline writes are
 * the outbox's job, not this worker's.
 */
registerRoute(
  new NavigationRoute(createHandlerBoundToURL("/index.html"), {
    denylist: [/^\/api\//],
  }),
);

/* --------------------------------------------------------------- lifecycle */

// `registerType: "autoUpdate"`: take over as soon as a new build is precached.
// A referee must never be pitchside on last week's bundle because the tab has
// been open since breakfast.
self.skipWaiting();
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

/* -------------------------------------------------------------------- push */

/** Mirrors `PushPayload` in `src/services/pushService.ts` on the backend. */
interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
}

function parsePayload(event: PushEvent): PushPayload | null {
  try {
    const data = event.data?.json() as Partial<PushPayload> | undefined;
    if (!data?.title || !data.body || !data.url || !data.tag) return null;
    return data as PushPayload;
  } catch {
    return null;
  }
}

self.addEventListener("push", (event) => {
  const payload = parsePayload(event);
  // A push with no usable payload is dropped rather than shown as a placeholder.
  // Browsers may fire a "budget" push with no data; an empty notification would
  // teach referees to ignore the channel.
  if (!payload) return;

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      // `tag` + `renotify`: a referee who missed two alerts wants the current
      // one, not a stack of stale ones — but the replacement must still buzz.
      tag: payload.tag,
      renotify: true,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: payload.url },
    } as NotificationOptions),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data as { url?: string } | null)?.url ?? "/ref";

  // Focus an open tab rather than piling up new ones: the referee usually
  // already has the app open, and the tab they have may hold a queued goal.
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of clients) {
        if (new URL(client.url).origin === self.location.origin) {
          await client.focus();
          await client.navigate(url).catch(() => {
            // Navigation can be refused (e.g. the client is unloading); the tab
            // is focused either way, which is the important half.
          });
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
