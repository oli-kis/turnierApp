import { useEffect, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { flush, getItems, isFlushing, pendingGoalsFor, subscribe, type PendingGoal } from "./outbox";
import { qk } from "./queries";

/** Snapshot of the queue for the offline banner. */
export interface OutboxState {
  pending: number;
  flushing: boolean;
}

// useSyncExternalStore demands a stable snapshot; recompute only on emit.
let cached: OutboxState = { pending: getItems().length, flushing: isFlushing() };
subscribe(() => {
  cached = { pending: getItems().length, flushing: isFlushing() };
});

export function useOutboxState(): OutboxState {
  return useSyncExternalStore(subscribe, () => cached);
}

/** Goals for this match still sitting in the queue, re-read on every queue change. */
export function usePendingGoals(matchId: string): PendingGoal[] {
  useOutboxState(); // subscribes this component to queue changes
  return pendingGoalsFor(matchId);
}

/**
 * Drives replay of queued referee writes: on reconnect, on mount (the app may
 * have been killed with a full queue), and on a slow tick while anything is
 * still pending — `online` can fire while the connection is still unusable.
 */
export function useOutboxFlush(matchId?: string): void {
  const qc = useQueryClient();

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (getItems().length === 0 || !navigator.onLine) return;
      await flush();
      if (cancelled) return;
      // Server state moved underneath the cache while we were away.
      if (matchId) void qc.invalidateQueries({ queryKey: qk.match(matchId) });
      void qc.invalidateQueries({ queryKey: qk.myMatches() });
    };

    void run();
    window.addEventListener("online", run);
    const tick = setInterval(run, 15_000);
    return () => {
      cancelled = true;
      window.removeEventListener("online", run);
      clearInterval(tick);
    };
  }, [qc, matchId]);
}
