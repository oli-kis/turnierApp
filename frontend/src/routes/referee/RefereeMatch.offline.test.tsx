import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { RefereeMatch } from "./RefereeMatch";
import { ToastProvider } from "../../components/Toast";
import { qk } from "../../api/queries";
import { __resetOutbox, getItems } from "../../api/outbox";
import * as ref from "../../api/endpoints/referee";
import type { MatchDetail, TournamentDetail } from "../../api/types";

/**
 * Regression: a goal tapped with no signal must reach the outbox.
 *
 * TanStack Query's default `networkMode: "online"` pauses a mutation while the
 * browser is offline — `onMutate` runs (so the score still bumps and the screen
 * looks fine) but `mutationFn` never does. The goal then lives only in React
 * Query's in-memory state and dies with the tab, which is exactly the silent
 * loss the outbox exists to prevent. The referee mutations opt out with
 * `networkMode: "always"`; this test fails if that opt-out is ever removed.
 */

const MATCH_ID = "m1";
const HOME_TEAM = "home-team-id";

class EventSourceStub {
  close() {}
  addEventListener() {}
  removeEventListener() {}
  onerror: unknown = null;
}

const match = {
  id: MATCH_ID,
  tournamentId: "t1",
  phase: "GROUP",
  status: "RUNNING",
  scoreHome: 0,
  scoreAway: 0,
  homeTeamId: HOME_TEAM,
  awayTeamId: "away-team-id",
  homeTeam: { id: HOME_TEAM, name: "Heimteam" },
  awayTeam: { id: "away-team-id", name: "Gastteam" },
  pitch: { id: "p1", name: "Platz 1" },
  slot: {
    id: "s1",
    index: 0,
    status: "RUNNING",
    plannedStart: new Date().toISOString(),
    actualStart: new Date().toISOString(),
  },
  goals: [],
} as unknown as MatchDetail;

const tournament = {
  id: "t1",
  name: "FC Frick Turnier",
  startAt: new Date().toISOString(),
  matchDurationMin: 12,
  transitionMin: 3,
  pitchCount: 2,
  status: "RUNNING",
} as TournamentDetail;

function setOnline(value: boolean) {
  Object.defineProperty(navigator, "onLine", { value, configurable: true });
}

function renderMatch(overrides: Partial<MatchDetail> = {}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  qc.setQueryData(qk.match(MATCH_ID), { ...match, ...overrides });
  qc.setQueryData(qk.tournament("t1"), tournament);

  render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter initialEntries={[`/ref/spiel/${MATCH_ID}`]}>
          <Routes>
            <Route path="/ref/spiel/:id" element={<RefereeMatch />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
  return qc;
}

beforeEach(() => {
  __resetOutbox();
  localStorage.clear();
  vi.stubGlobal("EventSource", EventSourceStub);
  setOnline(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setOnline(true);
});

describe("RefereeMatch offline scoring", () => {
  it("queues a goal tapped with no connection instead of losing it", async () => {
    const addGoal = vi.spyOn(ref, "addGoal");
    setOnline(false);
    renderMatch();

    await userEvent.click(screen.getByText("Heimteam"));

    await waitFor(() => expect(getItems()).toHaveLength(1));
    const [item] = getItems();
    expect(item.op).toMatchObject({ kind: "goal.add", matchId: MATCH_ID, teamId: HOME_TEAM });
    // Queued, not sent — and persisted, so closing the app cannot lose it.
    expect(addGoal).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem("outbox.v1")!)).toHaveLength(1);
  });

  it("shows the referee that the goal is held, not dropped", async () => {
    setOnline(false);
    renderMatch();

    await userEvent.click(screen.getByText("Heimteam"));

    expect(await screen.findByText("Offline — 1 Aktion wartet auf Verbindung")).toBeInTheDocument();
    expect(await screen.findByText("wird gesendet")).toBeInTheDocument();
  });

  it("sends straight through when online", async () => {
    const addGoal = vi.spyOn(ref, "addGoal").mockResolvedValue({ goalId: "g1" });
    renderMatch();

    await userEvent.click(screen.getByText("Heimteam"));

    await waitFor(() => expect(addGoal).toHaveBeenCalled());
    expect(addGoal.mock.calls[0][0]).toBe(MATCH_ID);
    expect(addGoal.mock.calls[0][1]).toBe(HOME_TEAM);
    expect(addGoal.mock.calls[0][2]).toMatch(/^g-/); // idempotency key travels with it
    expect(getItems()).toHaveLength(0);
  });
});

/**
 * Regression: finishing a drawn knockout match with no signal.
 *
 * The referee normally learns that penalties are needed from the server's
 * `409 PENALTIES_REQUIRED`. That answer needs a connection. Offline there is
 * none, so a queued `match.finish` would be replayed on reconnect, rejected with
 * that same 409, and — per the outbox's HTTP-error rule — dropped with a toast,
 * leaving a knockout match undecided. The client therefore decides "knockout +
 * draw ⇒ penalties" itself and queues the result instead of the finish.
 */
const DRAWN_KNOCKOUT: Partial<MatchDetail> = {
  phase: "SEMIFINAL",
  scoreHome: 1,
  scoreAway: 1,
} as Partial<MatchDetail>;

describe("RefereeMatch offline penalties", () => {
  it("asks for the penalty result without needing the server's 409", async () => {
    const finishMatch = vi.spyOn(ref, "finishMatch");
    setOnline(false);
    renderMatch(DRAWN_KNOCKOUT);

    await userEvent.click(screen.getByRole("button", { name: "Spiel beenden" }));
    await userEvent.click(screen.getByRole("button", { name: "Weiter" }));

    expect(await screen.findByText("Penaltyschiessen")).toBeInTheDocument();
    // Never asked the server whether penalties were needed — it couldn't have.
    expect(finishMatch).not.toHaveBeenCalled();
  });

  it("queues the penalty result instead of losing it", async () => {
    const submitPenalties = vi.spyOn(ref, "submitPenalties");
    setOnline(false);
    renderMatch(DRAWN_KNOCKOUT);

    await userEvent.click(screen.getByRole("button", { name: "Spiel beenden" }));
    await userEvent.click(screen.getByRole("button", { name: "Weiter" }));

    // 4 : 3 to the home team.
    const more = screen.getAllByLabelText("mehr");
    for (let i = 0; i < 4; i += 1) await userEvent.click(more[0]);
    for (let i = 0; i < 3; i += 1) await userEvent.click(more[1]);
    await userEvent.click(screen.getByRole("button", { name: "Speichern & beenden" }));

    await waitFor(() => expect(getItems()).toHaveLength(1));
    expect(getItems()[0].op).toMatchObject({
      kind: "match.penalties",
      matchId: MATCH_ID,
      home: 4,
      away: 3,
    });
    expect(submitPenalties).not.toHaveBeenCalled();
    // Persisted: the result that decides who goes through survives the tab.
    expect(JSON.parse(localStorage.getItem("outbox.v1")!)).toHaveLength(1);
  });

  it("never queues a finish alongside the penalty result", async () => {
    setOnline(false);
    renderMatch(DRAWN_KNOCKOUT);

    await userEvent.click(screen.getByRole("button", { name: "Spiel beenden" }));
    await userEvent.click(screen.getByRole("button", { name: "Weiter" }));
    await userEvent.click(screen.getAllByLabelText("mehr")[0]);
    await userEvent.click(screen.getByRole("button", { name: "Speichern & beenden" }));

    // The penalties endpoint finishes the match itself; a finish replayed after
    // it would hit a FINISHED match and be reported to the referee as a failure.
    await waitFor(() => expect(getItems()).toHaveLength(1));
    expect(getItems().map((i) => i.op.kind)).toEqual(["match.penalties"]);
  });

  it("finishes a decided knockout match directly, with no penalty detour", async () => {
    setOnline(false);
    renderMatch({ phase: "SEMIFINAL", scoreHome: 2, scoreAway: 1 } as Partial<MatchDetail>);

    await userEvent.click(screen.getByRole("button", { name: "Spiel beenden" }));
    await userEvent.click(screen.getByRole("button", { name: "Beenden" }));

    await waitFor(() => expect(getItems()).toHaveLength(1));
    expect(getItems()[0].op).toMatchObject({ kind: "match.finish" });
    expect(screen.queryByText("Penaltyschiessen")).not.toBeInTheDocument();
  });

  it("finishes a drawn group match directly — penalties are knockout-only", async () => {
    setOnline(false);
    renderMatch({ scoreHome: 1, scoreAway: 1 });

    await userEvent.click(screen.getByRole("button", { name: "Spiel beenden" }));
    await userEvent.click(screen.getByRole("button", { name: "Beenden" }));

    await waitFor(() => expect(getItems()).toHaveLength(1));
    expect(getItems()[0].op).toMatchObject({ kind: "match.finish" });
  });
});
