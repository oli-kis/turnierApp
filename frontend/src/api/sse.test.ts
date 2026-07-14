import { describe, it, expect, vi, beforeEach, type MockInstance } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { dispatchSseEvent } from "./sse";
import type { MatchDetail } from "./types";

const TID = "T1";

function keysFrom(spy: MockInstance): string[][] {
  return spy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey as string[]);
}

describe("dispatchSseEvent → query invalidation map", () => {
  let qc: QueryClient;
  let spy: MockInstance;

  beforeEach(() => {
    qc = new QueryClient();
    spy = vi.spyOn(qc, "invalidateQueries").mockResolvedValue(undefined) as MockInstance;
  });

  it("standings.updated invalidates standings", () => {
    dispatchSseEvent(qc, TID, "standings.updated", {});
    expect(keysFrom(spy)).toContainEqual(["standings"]);
  });

  it("bracket.updated invalidates bracket and match lists", () => {
    dispatchSseEvent(qc, TID, "bracket.updated", {});
    const keys = keysFrom(spy);
    expect(keys).toContainEqual(["bracket"]);
    expect(keys).toContainEqual(["matches", TID]);
  });

  it("match.finished invalidates match lists, standings, dashboard and the match", () => {
    dispatchSseEvent(qc, TID, "match.finished", { matchId: "m9" });
    const keys = keysFrom(spy);
    expect(keys).toContainEqual(["matches", TID]);
    expect(keys).toContainEqual(["standings"]);
    expect(keys).toContainEqual(["dashboard", TID]);
    expect(keys).toContainEqual(["match", "m9"]);
  });

  it("slot.started invalidates slots, dashboard and referee matches", () => {
    dispatchSseEvent(qc, TID, "slot.started", { slotId: "s1" });
    const keys = keysFrom(spy);
    expect(keys).toContainEqual(["slots", TID]);
    expect(keys).toContainEqual(["dashboard", TID]);
    expect(keys).toContainEqual(["myMatches"]);
  });

  it("referee.registered invalidates the referee list", () => {
    dispatchSseEvent(qc, TID, "referee.registered", { refereeId: "r1" });
    expect(keysFrom(spy)).toContainEqual(["referees"]);
  });

  it("goal.scored optimistically bumps the open match score, then invalidates", () => {
    const match: MatchDetail = {
      id: "m1",
      phase: "GROUP",
      status: "RUNNING",
      scoreHome: 1,
      scoreAway: 0,
      homeTeamId: "home",
      awayTeamId: "away",
    } as MatchDetail;
    qc.setQueryData(["match", "m1"], match);

    dispatchSseEvent(qc, TID, "goal.scored", { matchId: "m1", teamId: "away", goalId: "g1" });

    const updated = qc.getQueryData<MatchDetail>(["match", "m1"]);
    expect(updated?.scoreAway).toBe(1);
    expect(updated?.scoreHome).toBe(1);
    expect(keysFrom(spy)).toContainEqual(["match", "m1"]);
  });
});
