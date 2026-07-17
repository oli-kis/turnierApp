import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { ApiError } from "./client";
import {
  __resetOutbox,
  enqueue,
  flush,
  getItems,
  newClientId,
  sendOrQueue,
  type OutboxOp,
} from "./outbox";
import * as ref from "./endpoints/referee";
import { appBridge } from "./appBridge";

/**
 * The offline queue is the only thing standing between a pitchside 4G drop and a
 * lost goal, so its ordering, coalescing and failure semantics are pinned here.
 */

const networkError = () => new ApiError(0, "NETWORK", "Keine Verbindung zum Server");
const conflict = (msg = "Spiel läuft nicht mehr") => new ApiError(409, "MATCH_NOT_RUNNING", msg);

function setOnline(value: boolean) {
  Object.defineProperty(navigator, "onLine", { value, configurable: true });
}

beforeEach(() => {
  __resetOutbox();
  localStorage.clear();
  setOnline(true);
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const goal = (clientId: string): OutboxOp => ({
  kind: "goal.add",
  matchId: "m1",
  teamId: "t1",
  clientId,
});

describe("sendOrQueue", () => {
  it("sends immediately when online and the queue is empty", async () => {
    const addGoal = vi.spyOn(ref, "addGoal").mockResolvedValue({ goalId: "g1" });

    const sent = await sendOrQueue(goal("c1"));

    expect(sent).toBe(true);
    expect(addGoal).toHaveBeenCalledWith("m1", "t1", "c1");
    expect(getItems()).toHaveLength(0);
  });

  it("queues without attempting a request when offline", async () => {
    setOnline(false);
    const addGoal = vi.spyOn(ref, "addGoal");

    const sent = await sendOrQueue(goal("c1"));

    expect(sent).toBe(false);
    expect(addGoal).not.toHaveBeenCalled();
    expect(getItems()).toHaveLength(1);
  });

  it("queues when the request dies on the network", async () => {
    vi.spyOn(ref, "addGoal").mockRejectedValue(networkError());

    const sent = await sendOrQueue(goal("c1"));

    expect(sent).toBe(false);
    expect(getItems()).toHaveLength(1);
  });

  it("propagates a rejection the server made on the merits", async () => {
    vi.spyOn(ref, "addGoal").mockRejectedValue(conflict());

    await expect(sendOrQueue(goal("c1"))).rejects.toThrow("Spiel läuft nicht mehr");
    expect(getItems()).toHaveLength(0);
  });

  it("never lets a live write overtake queued ones", async () => {
    const order: string[] = [];
    vi.spyOn(ref, "addGoal").mockImplementation(async (_m, _t, clientId) => {
      order.push(clientId!);
      return { goalId: clientId! };
    });

    setOnline(false);
    await sendOrQueue(goal("first"));
    setOnline(true);
    await sendOrQueue(goal("second"));

    expect(order).toEqual(["first", "second"]);
    expect(getItems()).toHaveLength(0);
  });
});

describe("coalescing", () => {
  it("keeps only the referee's last ready/unready tap per match", () => {
    enqueue({ kind: "match.ready", matchId: "m1" });
    enqueue({ kind: "match.unready", matchId: "m1" });
    enqueue({ kind: "match.ready", matchId: "m1" });

    expect(getItems().map((i) => i.op.kind)).toEqual(["match.ready"]);
  });

  it("does not collapse ready state across different matches", () => {
    enqueue({ kind: "match.ready", matchId: "m1" });
    enqueue({ kind: "match.ready", matchId: "m2" });

    expect(getItems()).toHaveLength(2);
  });

  it("drops the queued goal instead of queueing a delete the server can't resolve", () => {
    enqueue(goal("c1"));
    enqueue({ kind: "goal.delete", goalId: "c1" });

    expect(getItems()).toHaveLength(0);
  });

  it("queues a delete for a goal the server already knows", () => {
    enqueue({ kind: "goal.delete", goalId: "server-goal-id" });

    expect(getItems().map((i) => i.op.kind)).toEqual(["goal.delete"]);
  });

  it("only removes the goal being undone", () => {
    enqueue(goal("c1"));
    enqueue(goal("c2"));
    enqueue({ kind: "goal.delete", goalId: "c1" });

    const remaining = getItems().map((i) => (i.op.kind === "goal.add" ? i.op.clientId : i.op.kind));
    expect(remaining).toEqual(["c2"]);
  });

  it("keeps only the last penalty result per match", () => {
    enqueue({ kind: "match.penalties", matchId: "m1", home: 4, away: 3 });
    enqueue({ kind: "match.penalties", matchId: "m1", home: 5, away: 4 });

    const items = getItems();
    expect(items).toHaveLength(1);
    expect(items[0].op).toMatchObject({ home: 5, away: 4 });
  });

  it("drops a queued finish when penalties are submitted for that match", () => {
    // The penalties endpoint finishes the match itself. A finish replayed after
    // it would hit a FINISHED match and be reported to the referee as a failure.
    enqueue({ kind: "match.finish", matchId: "m1" });
    enqueue({ kind: "match.penalties", matchId: "m1", home: 4, away: 3 });

    expect(getItems().map((i) => i.op.kind)).toEqual(["match.penalties"]);
  });

  it("does not collapse penalties across different matches", () => {
    enqueue({ kind: "match.penalties", matchId: "m1", home: 4, away: 3 });
    enqueue({ kind: "match.penalties", matchId: "m2", home: 2, away: 1 });
    enqueue({ kind: "match.finish", matchId: "m3" });

    expect(getItems()).toHaveLength(3);
  });
});

describe("flush", () => {
  it("replays queued writes in order and empties the queue", async () => {
    const calls: string[] = [];
    vi.spyOn(ref, "addGoal").mockImplementation(async (_m, _t, c) => {
      calls.push(`goal:${c}`);
      return { goalId: c! };
    });
    vi.spyOn(ref, "ready").mockImplementation(async () => {
      calls.push("ready");
    });

    enqueue(goal("c1"));
    enqueue({ kind: "match.ready", matchId: "m1" });
    enqueue(goal("c2"));

    const failures = await flush();

    expect(calls).toEqual(["goal:c1", "ready", "goal:c2"]);
    expect(failures).toEqual([]);
    expect(getItems()).toHaveLength(0);
  });

  it("stops at the first network error and keeps the rest queued", async () => {
    vi.spyOn(ref, "addGoal")
      .mockResolvedValueOnce({ goalId: "g1" })
      .mockRejectedValueOnce(networkError());

    enqueue(goal("c1"));
    enqueue(goal("c2"));
    enqueue(goal("c3"));

    await flush();

    // c1 sent; c2 hit the network error and must stay ahead of c3.
    const left = getItems().map((i) => (i.op.kind === "goal.add" ? i.op.clientId : i.op.kind));
    expect(left).toEqual(["c2", "c3"]);
  });

  it("drops a server-rejected write, reports it, and carries on", async () => {
    const toast = vi.spyOn(appBridge, "toast").mockImplementation(() => {});
    vi.spyOn(ref, "addGoal")
      .mockRejectedValueOnce(conflict())
      .mockResolvedValueOnce({ goalId: "g2" });

    enqueue(goal("c1"));
    enqueue(goal("c2"));

    const failures = await flush();

    expect(failures).toHaveLength(1);
    expect(failures[0].message).toBe("Spiel läuft nicht mehr");
    expect(toast).toHaveBeenCalledWith("Tor: Spiel läuft nicht mehr", "error");
    expect(getItems()).toHaveLength(0);
  });

  it("treats deleting an already-deleted goal as done, not as a failure", async () => {
    const toast = vi.spyOn(appBridge, "toast").mockImplementation(() => {});
    vi.spyOn(ref, "deleteGoal").mockRejectedValue(new ApiError(404, "NOT_FOUND", "Goal not found"));

    enqueue({ kind: "goal.delete", goalId: "gone" });
    const failures = await flush();

    expect(failures).toEqual([]);
    expect(toast).not.toHaveBeenCalled();
    expect(getItems()).toHaveLength(0);
  });

  it("survives a reload with the queue intact", async () => {
    enqueue(goal("c1"));
    expect(JSON.parse(localStorage.getItem("outbox.v1")!)).toHaveLength(1);
  });

  it("replays a penalty result with the referee's numbers", async () => {
    const submit = vi.spyOn(ref, "submitPenalties").mockResolvedValue(undefined);

    enqueue({ kind: "match.penalties", matchId: "m1", home: 4, away: 3 });
    const failures = await flush();

    expect(submit).toHaveBeenCalledWith("m1", 4, 3);
    expect(failures).toEqual([]);
    expect(getItems()).toHaveLength(0);
  });

  it("replays goals before the penalty result that depends on them", async () => {
    // Penalties are rejected unless the match is drawn, so the goals that made it
    // a draw have to land first. Queue order is the only thing guaranteeing that.
    const calls: string[] = [];
    vi.spyOn(ref, "addGoal").mockImplementation(async (_m, _t, c) => {
      calls.push(`goal:${c}`);
      return { goalId: c! };
    });
    vi.spyOn(ref, "submitPenalties").mockImplementation(async () => {
      calls.push("pens");
    });

    enqueue(goal("c1"));
    enqueue({ kind: "match.penalties", matchId: "m1", home: 4, away: 3 });

    await flush();

    expect(calls).toEqual(["goal:c1", "pens"]);
  });

  it("reports a rejected penalty result rather than losing it silently", async () => {
    const toast = vi.spyOn(appBridge, "toast").mockImplementation(() => {});
    vi.spyOn(ref, "submitPenalties").mockRejectedValue(
      new ApiError(409, "PENALTIES_ALREADY_SET", "Spiel ist bereits mit 5:4 entschieden"),
    );

    enqueue({ kind: "match.penalties", matchId: "m1", home: 4, away: 3 });
    const failures = await flush();

    expect(failures).toHaveLength(1);
    expect(toast).toHaveBeenCalledWith(
      "Penaltyresultat: Spiel ist bereits mit 5:4 entschieden",
      "error",
    );
    expect(getItems()).toHaveLength(0);
  });

  it("keeps the penalty result queued while the phone has no signal", async () => {
    vi.spyOn(ref, "submitPenalties").mockRejectedValue(networkError());

    enqueue({ kind: "match.penalties", matchId: "m1", home: 4, away: 3 });
    await flush();

    // The result that decides who goes through must survive to the next attempt.
    expect(getItems()).toHaveLength(1);
  });
});

describe("newClientId", () => {
  it("mints unique keys so replays dedupe but distinct taps do not", () => {
    const ids = new Set(Array.from({ length: 100 }, newClientId));
    expect(ids.size).toBe(100);
  });
});
