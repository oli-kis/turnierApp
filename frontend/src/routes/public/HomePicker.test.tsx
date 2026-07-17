import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { HomePicker } from "./HomePicker";

/**
 * Integration smoke: the real screen renders through QueryClient + Router,
 * fetching + Zod-parsing a realistic tournaments payload. Catches provider,
 * parsing, and runtime wiring problems a typecheck cannot.
 */
const TOURNAMENT = {
  id: "t1",
  name: "FC Frick Cup",
  startAt: "2026-07-20T06:00:00.000Z",
  matchDurationMin: 12,
  transitionMin: 3,
  pitchCount: 4,
  status: "DRAFT",
  entryFeeRp: 0,
  registrationOpen: false,
  registrationDeadline: null,
};

function stubApi(tournament: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify({ tournaments: [tournament] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
}

function renderPicker() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <HomePicker />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("HomePicker (integration)", () => {
  beforeEach(() => stubApi(TOURNAMENT));
  afterEach(() => vi.unstubAllGlobals());

  it("renders the tournament from the API", async () => {
    renderPicker();

    await waitFor(() => expect(screen.getByText("FC Frick Cup")).toBeInTheDocument());
    expect(screen.getByText(/4 Plätze/)).toBeInTheDocument();
  });

  it("offers registration when it is open", async () => {
    stubApi({ ...TOURNAMENT, entryFeeRp: 10000, registrationOpen: true });
    renderPicker();

    const link = await screen.findByRole("link", { name: "Team anmelden" });
    expect(link).toHaveAttribute("href", "/t/t1/anmelden");
  });

  it("says so rather than hiding when registration is closed", async () => {
    stubApi({ ...TOURNAMENT, entryFeeRp: 10000, registrationOpen: false });
    renderPicker();

    // A missing button reads as a broken site — which produces the phone call
    // the entry point exists to prevent.
    expect(await screen.findByText("Anmeldung geschlossen")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Team anmelden" })).not.toBeInTheDocument();
  });

  it("stays silent for a tournament with no entry fee configured", async () => {
    renderPicker();

    await waitFor(() => expect(screen.getByText("FC Frick Cup")).toBeInTheDocument());
    // Not collecting entries here at all; "closed" would be noise.
    expect(screen.queryByText("Anmeldung geschlossen")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Team anmelden" })).not.toBeInTheDocument();
  });

  it("treats a passed deadline as closed", async () => {
    stubApi({
      ...TOURNAMENT,
      entryFeeRp: 10000,
      registrationOpen: true,
      registrationDeadline: "2020-01-01T00:00:00.000Z",
    });
    renderPicker();

    expect(await screen.findByText("Anmeldung geschlossen")).toBeInTheDocument();
  });
});
