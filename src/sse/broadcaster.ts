import type { FastifyReply } from "fastify";

/**
 * In-process Server-Sent-Events broadcaster, keyed by tournamentId. One server
 * process serves one weekend, so no external bus is needed.
 *
 * Payloads carry ids only where possible (per CLAUDE.md); clients refetch
 * detail over the authed/public REST endpoints.
 */
export type SseEventType =
  | "slot.waiting-ready"
  | "match.ready"
  | "match.unready"
  | "slot.started"
  | "goal.scored"
  | "goal.deleted"
  | "match.finished"
  | "slot.finished"
  | "schedule.updated"
  | "standings.updated"
  | "bracket.updated"
  | "referee.registered"
  // id only — the admin refetches over the authed endpoint. Contact data must
  // never reach the public stream.
  | "registration.paid";

interface Subscriber {
  id: number;
  reply: FastifyReply;
}

class Broadcaster {
  private subscribers = new Map<string, Set<Subscriber>>();
  private nextId = 1;

  subscribe(tournamentId: string, reply: FastifyReply): () => void {
    const sub: Subscriber = { id: this.nextId++, reply };
    let set = this.subscribers.get(tournamentId);
    if (!set) {
      set = new Set();
      this.subscribers.set(tournamentId, set);
    }
    set.add(sub);

    return () => {
      const current = this.subscribers.get(tournamentId);
      if (current) {
        current.delete(sub);
        if (current.size === 0) this.subscribers.delete(tournamentId);
      }
    };
  }

  broadcast(tournamentId: string, type: SseEventType, data: Record<string, unknown>): void {
    const set = this.subscribers.get(tournamentId);
    if (!set || set.size === 0) return;
    const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const sub of set) {
      try {
        sub.reply.raw.write(payload);
      } catch {
        // A dead connection is cleaned up on its own 'close' handler; skip it.
      }
    }
  }

  /** Broadcast to every subscriber across all tournaments (e.g. referee.registered). */
  broadcastAll(type: SseEventType, data: Record<string, unknown>): void {
    for (const tournamentId of this.subscribers.keys()) {
      this.broadcast(tournamentId, type, data);
    }
  }

  /** Comment line to keep proxies from closing an idle connection. */
  heartbeat(tournamentId: string): void {
    const set = this.subscribers.get(tournamentId);
    if (!set) return;
    for (const sub of set) {
      try {
        sub.reply.raw.write(`: ping\n\n`);
      } catch {
        // ignore
      }
    }
  }
}

export const broadcaster = new Broadcaster();
