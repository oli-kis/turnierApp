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
describe("HomePicker (integration)", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            tournaments: [
              {
                id: "t1",
                name: "FC Frick Cup",
                startAt: "2026-07-20T06:00:00.000Z",
                matchDurationMin: 12,
                transitionMin: 3,
                pitchCount: 4,
                status: "DRAFT",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it("renders the tournament from the API", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <HomePicker />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByText("FC Frick Cup")).toBeInTheDocument());
    expect(screen.getByText(/4 Plätze/)).toBeInTheDocument();
  });
});
