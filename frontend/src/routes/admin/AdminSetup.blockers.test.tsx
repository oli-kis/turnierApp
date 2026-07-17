import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AdminSetup } from "./AdminSetup";
import { ToastProvider } from "../../components/Toast";
import { qk } from "../../api/queries";
import * as struct from "../../api/endpoints/structure";
import { ApiError } from "../../api/client";
import type { TournamentDetail } from "../../api/types";

/**
 * The two registration guards on schedule generation, as the admin meets them.
 *
 * Both are steps missed rather than errors, and both are recoverable only if the
 * screen says which step — so the message, and the list of teams, are the
 * feature. A bare "409" here means an admin phoning the developer on tournament
 * morning.
 */

const TOURNAMENT = {
  id: "t1",
  name: "FC Frick Cup",
  startAt: "2026-07-20T06:00:00.000Z",
  matchDurationMin: 12,
  transitionMin: 3,
  pitchCount: 4,
  status: "DRAFT",
  entryFeeRp: 10000,
  registrationOpen: false,
  registrationDeadline: null,
  categories: [],
  pitches: [],
} as unknown as TournamentDetail;

class EventSourceStub {
  close() {}
  addEventListener() {}
  removeEventListener() {}
  onerror: unknown = null;
}

function renderSetup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(qk.tournament("t1"), TOURNAMENT);
  qc.setQueryData(qk.slots("t1"), []);
  qc.setQueryData(qk.registrations("t1", undefined), []);
  render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter initialEntries={["/admin/t/t1/setup"]}>
          <Routes>
            <Route path="/admin/t/:id/setup" element={<AdminSetup />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal("EventSource", EventSourceStub);
});

describe("schedule generation blockers", () => {
  it("tells the admin to close registration first", async () => {
    vi.spyOn(struct, "generateSchedule").mockRejectedValue(
      new ApiError(409, "REGISTRATION_STILL_OPEN", "Close registration before generating"),
    );
    const user = userEvent.setup();
    renderSetup();

    await user.click(screen.getByRole("button", { name: "Spielplan erstellen" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Anmeldung ist noch offen");
    // Names the step, not the error code.
    expect(alert).toHaveTextContent("Grunddaten");
  });

  it("lists the teams that still have no group", async () => {
    vi.spyOn(struct, "generateSchedule").mockRejectedValue(
      new ApiError(409, "UNASSIGNED_TEAMS", "2 team(s) are not assigned to a group", {
        teams: [
          { id: "t-1", name: "Falcons" },
          { id: "t-2", name: "Rockets" },
        ],
      }),
    );
    const user = userEvent.setup();
    renderSetup();

    await user.click(screen.getByRole("button", { name: "Spielplan erstellen" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("2 Teams sind noch keiner Gruppe zugeteilt");
    // The admin has to find them; naming them is the difference between a fix
    // and a hunt through every category.
    expect(alert).toHaveTextContent("Falcons");
    expect(alert).toHaveTextContent("Rockets");
  });

  it("uses the singular for one team", async () => {
    vi.spyOn(struct, "generateSchedule").mockRejectedValue(
      new ApiError(409, "UNASSIGNED_TEAMS", "1 team(s) are not assigned to a group", {
        teams: [{ id: "t-1", name: "Falcons" }],
      }),
    );
    const user = userEvent.setup();
    renderSetup();

    await user.click(screen.getByRole("button", { name: "Spielplan erstellen" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("1 Team ist noch keiner Gruppe");
  });

  it("survives UNASSIGNED_TEAMS without a team list", async () => {
    vi.spyOn(struct, "generateSchedule").mockRejectedValue(
      new ApiError(409, "UNASSIGNED_TEAMS", "teams are not assigned"),
    );
    const user = userEvent.setup();
    renderSetup();

    await user.click(screen.getByRole("button", { name: "Spielplan erstellen" }));

    // Degrades to the message rather than crashing on absent details.
    expect(await screen.findByRole("alert")).toHaveTextContent("noch keiner Gruppe zugeteilt");
  });

  it("does not dress up an unrelated error as a registration problem", async () => {
    vi.spyOn(struct, "generateSchedule").mockRejectedValue(
      new ApiError(422, "NO_GROUPS", "No groups with at least 2 teams to schedule"),
    );
    const user = userEvent.setup();
    renderSetup();

    await user.click(screen.getByRole("button", { name: "Spielplan erstellen" }));

    await waitFor(() => expect(struct.generateSchedule).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
