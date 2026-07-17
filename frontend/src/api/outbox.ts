import { ApiError } from "./client";
import { appBridge } from "./appBridge";
import * as ref from "./endpoints/referee";

/**
 * Offline write queue for the referee screen.
 *
 * Pitchside 4G drops mid-match, and a goal that vanishes because the phone had
 * no signal is the worst failure this app has. Every referee write goes through
 * `sendOrQueue`: sent immediately when it can be, otherwise persisted and
 * replayed on reconnect.
 *
 * This lives in the app rather than in a service worker on purpose — the
 * Background Sync API is unsupported in Safari, and half the referees are on
 * iPhones, so a SW-based queue would silently do nothing for them.
 */

export type OutboxOp =
  | { kind: "goal.add"; matchId: string; teamId: string; clientId: string }
  | { kind: "goal.delete"; goalId: string }
  | { kind: "match.ready"; matchId: string }
  | { kind: "match.unready"; matchId: string }
  | { kind: "match.finish"; matchId: string }
  | { kind: "match.penalties"; matchId: string; home: number; away: number };

export interface OutboxItem {
  id: string;
  op: OutboxOp;
  createdAt: number;
}

/** Reported to the UI after a replay item is dropped, so nothing fails silently. */
export interface OutboxFailure {
  op: OutboxOp;
  message: string;
}

const STORAGE_KEY = "outbox.v1";

/* ------------------------------------------------------------- persistence */

function load(): OutboxItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as OutboxItem[]) : [];
  } catch {
    return [];
  }
}

function persist(items: OutboxItem[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // A full or unavailable localStorage must not break scoring; the queue then
    // only lives in memory for this session.
  }
}

/* ------------------------------------------------------------------ store */

let items: OutboxItem[] = load();
let flushing = false;
const listeners = new Set<() => void>();

function emit(): void {
  persist(items);
  for (const l of listeners) l();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getItems(): readonly OutboxItem[] {
  return items;
}

/** A goal tapped but not yet acknowledged by the server. */
export interface PendingGoal {
  /** The clientId — the only handle that exists before the server assigns one. */
  id: string;
  teamId: string;
}

/**
 * Queued goals for a match, so the undo row can list and delete a goal that has
 * not reached the server yet. Derived from the queue rather than mirrored into
 * the query cache: the outbox already is the source of truth for unsent writes.
 */
export function pendingGoalsFor(matchId: string): PendingGoal[] {
  return items
    .filter((i) => i.op.kind === "goal.add" && i.op.matchId === matchId)
    .map((i) => {
      const op = i.op as Extract<OutboxOp, { kind: "goal.add" }>;
      return { id: op.clientId, teamId: op.teamId };
    });
}

export function isFlushing(): boolean {
  return flushing;
}

/** Test seam — resets the in-memory queue and storage. */
export function __resetOutbox(): void {
  items = [];
  flushing = false;
  persist(items);
}

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Idempotency key for a goal tap, minted before the request is ever attempted. */
export function newClientId(): string {
  return `g-${newId()}`;
}

/* -------------------------------------------------------------- coalescing */

/**
 * Collapse an incoming op against what is already queued, so a replay can never
 * fight itself:
 *  - ready/unready is a toggle — only the referee's last tap matters.
 *  - deleting a goal that has not been sent yet drops its queued `goal.add`
 *    rather than queueing a delete for an id the server has never seen.
 *  - a penalty result is a value, not an event: only the last one counts, and it
 *    finishes the match by itself.
 */
function coalesce(queue: OutboxItem[], op: OutboxOp): { queue: OutboxItem[]; enqueue: boolean } {
  if (op.kind === "match.ready" || op.kind === "match.unready") {
    const next = queue.filter(
      (i) =>
        !(
          (i.op.kind === "match.ready" || i.op.kind === "match.unready") &&
          i.op.matchId === op.matchId
        ),
    );
    return { queue: next, enqueue: true };
  }

  if (op.kind === "match.penalties") {
    // Drop any earlier penalty result for this match (the referee corrected the
    // number before regaining signal) and any queued finish: the penalties
    // endpoint finishes the match itself, and a finish replayed afterwards would
    // hit a FINISHED match and be reported to the referee as a failure.
    const next = queue.filter(
      (i) =>
        !(
          (i.op.kind === "match.penalties" || i.op.kind === "match.finish") &&
          i.op.matchId === op.matchId
        ),
    );
    return { queue: next, enqueue: true };
  }

  if (op.kind === "goal.delete") {
    const pendingAdd = queue.find(
      (i) => i.op.kind === "goal.add" && i.op.clientId === op.goalId,
    );
    if (pendingAdd) {
      return { queue: queue.filter((i) => i.id !== pendingAdd.id), enqueue: false };
    }
  }

  return { queue, enqueue: true };
}

export function enqueue(op: OutboxOp): void {
  const { queue, enqueue: shouldAdd } = coalesce(items, op);
  items = shouldAdd ? [...queue, { id: newId(), op, createdAt: Date.now() }] : queue;
  emit();
}

/* --------------------------------------------------------------- executing */

function execute(op: OutboxOp): Promise<unknown> {
  switch (op.kind) {
    case "goal.add":
      return ref.addGoal(op.matchId, op.teamId, op.clientId);
    case "goal.delete":
      return ref.deleteGoal(op.goalId);
    case "match.ready":
      return ref.ready(op.matchId);
    case "match.unready":
      return ref.unready(op.matchId);
    case "match.finish":
      return ref.finishMatch(op.matchId);
    case "match.penalties":
      return ref.submitPenalties(op.matchId, op.home, op.away);
  }
}

/** German label for an op, used when a queued write has to be reported as lost. */
export function describeOp(op: OutboxOp): string {
  switch (op.kind) {
    case "goal.add":
      return "Tor";
    case "goal.delete":
      return "Tor löschen";
    case "match.ready":
      return "Bereitmeldung";
    case "match.unready":
      return "Bereit zurückgenommen";
    case "match.finish":
      return "Spiel beenden";
    case "match.penalties":
      return "Penaltyresultat";
  }
}

/** A connection failure (vs. the server rejecting the request on its merits). */
function isNetworkError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 0;
}

/**
 * A rejection the replay should treat as already-done rather than a failure:
 * deleting a goal that is already gone reached the intended end state.
 */
function isBenign(op: OutboxOp, err: unknown): boolean {
  return op.kind === "goal.delete" && err instanceof ApiError && err.status === 404;
}

/**
 * Send now if possible, otherwise queue. Returns true when the write reached
 * the server, false when it was queued for later.
 */
export async function sendOrQueue(op: OutboxOp): Promise<boolean> {
  if (!navigator.onLine) {
    enqueue(op);
    return false;
  }
  // Anything already queued must go first, or a live write could overtake it.
  if (items.length > 0) {
    enqueue(op);
    await flush();
    return false;
  }
  try {
    await execute(op);
    return true;
  } catch (err) {
    if (isNetworkError(err)) {
      enqueue(op);
      return false;
    }
    throw err;
  }
}

/**
 * Replay the queue in order.
 *
 * Network error → stop and keep everything for the next reconnect.
 * HTTP error → drop that item and report it. A 409 here is a legal race on
 * tournament day ("slot already finished"); retrying it forever would wedge the
 * queue and hide the truth from the referee.
 */
export async function flush(): Promise<OutboxFailure[]> {
  if (flushing || items.length === 0) return [];
  flushing = true;
  emit();

  const failures: OutboxFailure[] = [];
  try {
    while (items.length > 0) {
      const [next] = items;
      try {
        await execute(next.op);
      } catch (err) {
        if (isNetworkError(err)) break; // still offline — keep the queue intact
        if (!isBenign(next.op, err)) {
          const message = err instanceof ApiError ? err.message : "Konnte nicht gesendet werden";
          failures.push({ op: next.op, message });
          // Reported here rather than by the caller: a flush triggered by the
          // `online` event has no component waiting on it, and a dropped goal
          // must never disappear quietly.
          appBridge.toast(`${describeOp(next.op)}: ${message}`, "error");
        }
      }
      items = items.filter((i) => i.id !== next.id);
      emit();
    }
  } finally {
    flushing = false;
    emit();
  }
  return failures;
}
