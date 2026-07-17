import webpush from "web-push";
import { prisma } from "../db/client.js";
import { env } from "../lib/env.js";

/**
 * Web Push for referees — "you are assigned" and "your slot is up now".
 *
 * Two rules shape everything here:
 *
 * 1. **Push is optional.** Without a VAPID keypair the feature reports itself
 *    unavailable and every send is a no-op. A dev machine, a test run, or a club
 *    that doesn't want notifications must not need configuration to work.
 * 2. **A send must never affect the request that triggered it.** These fire from
 *    inside slot cascades and admin edits. A referee's dead push endpoint cannot
 *    be allowed to fail an admin's assignment or wedge the slot cascade, so
 *    sends are fire-and-forget and swallow their own errors — see `notify`.
 */

const enabled = Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);

if (enabled) {
  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!);
}

export function isPushEnabled(): boolean {
  return enabled;
}

export function publicKey(): string | null {
  return enabled ? env.VAPID_PUBLIC_KEY! : null;
}

/** What the service worker receives; kept in sync with `frontend/src/sw.ts`. */
export interface PushPayload {
  title: string;
  body: string;
  /** Path the notification opens, e.g. `/ref/spiel/<id>`. */
  url: string;
  /**
   * Collapse key. A referee who missed three slot alerts wants the current one,
   * not a stack of stale ones, so alerts for the same match replace each other.
   */
  tag: string;
}

/** The browser is telling us this subscription is dead for good. */
function isGone(err: unknown): boolean {
  const status = (err as { statusCode?: number } | null)?.statusCode;
  return status === 404 || status === 410;
}

/** What a send did. Ignored by the triggers; `npm run push:test` reports it. */
export interface SendReport {
  sent: number;
  failed: number;
  /** Endpoints the push service reported as dead, and we deleted. */
  pruned: number;
  errors: string[];
}

/**
 * Send to every device a referee has registered.
 *
 * Expired endpoints are pruned as they are discovered: phones get replaced and
 * browsers rotate subscriptions, and without this the table only ever grows and
 * every send pays for a handful of guaranteed 410s.
 *
 * Returns a report rather than throwing. The triggers ignore it — a failed
 * notification must never surface as a failed assignment — but discarding the
 * outcome entirely would make this impossible to test, so the information is
 * offered and simply not consumed on the hot path.
 */
export async function sendToUser(userId: string, payload: PushPayload): Promise<SendReport> {
  const report: SendReport = { sent: 0, failed: 0, pruned: 0, errors: [] };
  if (!enabled) return report;

  const subs = await prisma.pushSubscription.findMany({ where: { userId } });
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload),
        );
        report.sent += 1;
      } catch (err) {
        report.failed += 1;
        report.errors.push(
          `${(err as { statusCode?: number })?.statusCode ?? "?"}: ${(err as Error)?.message ?? err}`,
        );
        if (isGone(err)) {
          await prisma.pushSubscription.deleteMany({ where: { endpoint: sub.endpoint } });
          report.pruned += 1;
        }
        // Any other failure is the push service's problem, not ours. The referee
        // still has the app, the SSE stream and the schedule; a notification is
        // an extra, never the channel of record.
      }
    }),
  );
  return report;
}

/**
 * Fire-and-forget wrapper. Callers are request handlers and slot cascades that
 * must not await — or fail because of — a notification.
 */
function notify(promise: Promise<void>): void {
  void promise.catch(() => {
    // Deliberately swallowed: see the module comment.
  });
}

function matchLabel(m: {
  homeTeam: { name: string } | null;
  awayTeam: { name: string } | null;
}): string {
  return `${m.homeTeam?.name ?? "?"} – ${m.awayTeam?.name ?? "?"}`;
}

/** Time in the tournament's own idiom (de-CH, 24h), matching the UI. */
function formatTime(date: Date | null): string {
  if (!date) return "";
  return new Intl.DateTimeFormat("de-CH", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

/**
 * A referee was assigned to a match. Sent on assignment only — reassigning the
 * pitch or slot of a match the referee already knows about is not news.
 */
export function notifyRefereeAssigned(matchId: string, refereeId: string): void {
  if (!enabled) return;
  notify(
    (async () => {
      const match = await prisma.match.findUnique({
        where: { id: matchId },
        include: { homeTeam: true, awayTeam: true, pitch: true, slot: true, category: true },
      });
      if (!match) return;

      const time = formatTime(match.slot?.plannedStart ?? null);
      const where = [match.pitch?.name, time].filter(Boolean).join(" · ");
      await sendToUser(refereeId, {
        title: "Neues Spiel für dich",
        body: [`${match.category.name}: ${matchLabel(match)}`, where].filter(Boolean).join("\n"),
        url: `/ref/spiel/${match.id}`,
        tag: `assign-${match.id}`,
      });
    })(),
  );
}

/**
 * A slot opened for ready-checks — the one notification that actually matters on
 * tournament day: it is the referee's cue to walk to the pitch and press the
 * button the whole slot is waiting on.
 */
export function notifySlotWaitingReady(slotId: string): void {
  if (!enabled) return;
  notify(
    (async () => {
      const matches = await prisma.match.findMany({
        where: { slotId, refereeId: { not: null } },
        include: { homeTeam: true, awayTeam: true, pitch: true },
      });
      await Promise.all(
        matches.map((m) =>
          sendToUser(m.refereeId!, {
            title: "Dein Spiel ist dran",
            body: [matchLabel(m), m.pitch?.name].filter(Boolean).join("\n"),
            url: `/ref/spiel/${m.id}`,
            tag: `slot-${m.id}`,
          }),
        ),
      );
    })(),
  );
}
