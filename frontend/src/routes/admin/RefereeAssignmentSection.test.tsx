import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RefereeAssignmentSection } from "./RefereeAssignmentSection";
import { qk } from "../../api/queries";
import type { MatchListItem, Slot, Referee } from "../../api/types";

const TID = "t1";

/**
 * Regression for improvements.md item 3: the assignment dropdown must be driven
 * by server state. A match that already has a refereeId must render its dropdown
 * pre-selected to that referee — not blank — after mount.
 */
function renderWithData() {
  const qc = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });

  const slot: Slot = { id: "s1", index: 0, status: "PENDING", plannedStart: new Date().toISOString() };
  const referee: Referee = {
    id: "ref1",
    name: "Rita Referee",
    email: "rita@test.ch",
    status: "APPROVED",
    createdAt: new Date().toISOString(),
  };
  const match = {
    id: "m1",
    phase: "GROUP",
    status: "SCHEDULED",
    refereeId: "ref1",
    scoreHome: 0,
    scoreAway: 0,
    slot: { id: "s1", index: 0, status: "PENDING" },
    pitch: { id: "p1", name: "Platz 1" },
    homeTeam: { id: "h", name: "Home" },
    awayTeam: { id: "a", name: "Away" },
  } as unknown as MatchListItem;

  qc.setQueryData(qk.slots(TID), [slot]);
  qc.setQueryData(qk.matches(TID, {}), [match]);
  qc.setQueryData(qk.referees("APPROVED"), [referee]);

  render(
    <QueryClientProvider client={qc}>
      <RefereeAssignmentSection tournamentId={TID} />
    </QueryClientProvider>,
  );
}

describe("RefereeAssignmentSection", () => {
  it("pre-selects the persisted referee in the dropdown", () => {
    renderWithData();
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe("ref1");
  });
});
