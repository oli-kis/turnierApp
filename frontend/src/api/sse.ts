import { useEffect } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { qk } from "./queries";
import type { MatchDetail } from "./types";

/**
 * One EventSource per open tournament. Events map to query invalidations (never
 * hand-patch caches except the goal.scored optimistic bump). Reconnect with
 * exponential backoff (max 15s); on reconnect, invalidate everything
 * tournament-scoped once — pitchside 4G drops.
 */

type Payload = Record<string, unknown>;

function parse(data: string): Payload {
  try {
    return JSON.parse(data) as Payload;
  } catch {
    return {};
  }
}

function invalidateTournamentScoped(qc: QueryClient, tid: string): void {
  qc.invalidateQueries({ queryKey: qk.dashboard(tid) });
  qc.invalidateQueries({ queryKey: qk.slots(tid) });
  qc.invalidateQueries({ queryKey: qk.matchLists(tid) });
  qc.invalidateQueries({ queryKey: ["standings"] });
  qc.invalidateQueries({ queryKey: ["bracket"] });
  qc.invalidateQueries({ queryKey: qk.myMatches() });
}

function makeHandlers(qc: QueryClient, tid: string): Record<string, (p: Payload) => void> {
  const dash = () => qc.invalidateQueries({ queryKey: qk.dashboard(tid) });
  const slots = () => qc.invalidateQueries({ queryKey: qk.slots(tid) });
  const matchLists = () => qc.invalidateQueries({ queryKey: qk.matchLists(tid) });
  const myMatches = () => qc.invalidateQueries({ queryKey: qk.myMatches() });
  const standings = () => qc.invalidateQueries({ queryKey: ["standings"] });
  const bracket = () => qc.invalidateQueries({ queryKey: ["bracket"] });
  const matchDetail = (p: Payload) => {
    if (typeof p.matchId === "string") qc.invalidateQueries({ queryKey: qk.match(p.matchId) });
  };

  return {
    "match.ready": (p) => {
      dash();
      slots();
      matchDetail(p);
    },
    "match.unready": (p) => {
      dash();
      slots();
      matchDetail(p);
    },
    "slot.waiting-ready": () => {
      slots();
      dash();
      myMatches();
    },
    "slot.started": () => {
      slots();
      dash();
      myMatches();
    },
    "slot.finished": () => {
      slots();
      dash();
      myMatches();
    },
    "goal.scored": (p) => {
      // Optimistic-feel bump on the open match detail, then invalidate.
      if (typeof p.matchId === "string" && typeof p.teamId === "string") {
        qc.setQueryData<MatchDetail>(qk.match(p.matchId), (prev) =>
          prev
            ? {
                ...prev,
                scoreHome: prev.homeTeamId === p.teamId ? prev.scoreHome + 1 : prev.scoreHome,
                scoreAway: prev.awayTeamId === p.teamId ? prev.scoreAway + 1 : prev.scoreAway,
              }
            : prev,
        );
      }
      matchDetail(p);
      dash();
    },
    "goal.deleted": (p) => {
      matchDetail(p);
      dash();
    },
    "match.finished": (p) => {
      matchLists();
      standings();
      dash();
      matchDetail(p);
    },
    "schedule.updated": () => {
      slots();
      matchLists();
    },
    "standings.updated": () => {
      standings();
    },
    "bracket.updated": () => {
      bracket();
      matchLists();
    },
    "referee.registered": () => {
      qc.invalidateQueries({ queryKey: ["referees"] });
    },
    // A team paid. The admin's Anmeldungen list gains a row, and the group
    // editor gains an unassigned team to place.
    "registration.paid": () => {
      qc.invalidateQueries({ queryKey: qk.registrationLists(tid) });
      qc.invalidateQueries({ queryKey: qk.tournament(tid) });
    },
  };
}

export const SSE_EVENT_TYPES = [
  "match.ready",
  "match.unready",
  "slot.waiting-ready",
  "slot.started",
  "slot.finished",
  "goal.scored",
  "goal.deleted",
  "match.finished",
  "schedule.updated",
  "standings.updated",
  "bracket.updated",
  "referee.registered",
  "registration.paid",
] as const;

/** Exposed for unit testing the mapping without a live EventSource. */
export function dispatchSseEvent(
  qc: QueryClient,
  tid: string,
  type: string,
  payload: Payload,
): void {
  const handlers = makeHandlers(qc, tid);
  handlers[type]?.(payload);
}

export function useTournamentEvents(tournamentId: string | undefined): void {
  const qc = useQueryClient();

  useEffect(() => {
    if (!tournamentId) return;
    const handlers = makeHandlers(qc, tournamentId);

    let es: EventSource | null = null;
    let closed = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      es = new EventSource(`/api/tournaments/${tournamentId}/events`);

      es.onopen = () => {
        if (attempt > 0) invalidateTournamentScoped(qc, tournamentId);
        attempt = 0;
      };

      for (const type of SSE_EVENT_TYPES) {
        es.addEventListener(type, (e) => handlers[type]?.(parse((e as MessageEvent).data)));
      }

      es.onerror = () => {
        es?.close();
        if (closed) return;
        const delay = Math.min(15_000, 1_000 * 2 ** attempt);
        attempt++;
        timer = setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      closed = true;
      es?.close();
      if (timer) clearTimeout(timer);
    };
  }, [tournamentId, qc]);
}
