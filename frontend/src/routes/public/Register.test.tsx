import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Register } from "./Register";
import { qk } from "../../api/queries";
import * as regApi from "../../api/endpoints/registrations";
import { ApiError } from "../../api/client";
import type { TournamentDetail } from "../../api/types";

/**
 * The registration funnel. What matters here is not the layout but the three
 * things that lose the club money or the payer's evening: the fee shown, the
 * name-taken error landing on the field, and the form surviving the round trip
 * to Stripe.
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
  registrationOpen: true,
  registrationDeadline: null,
  categories: [
    { id: "c1", tournamentId: "t1", name: "Junioren D", knockoutGenerated: false },
    { id: "c2", tournamentId: "t1", name: "Junioren E", knockoutGenerated: false },
  ],
} as unknown as TournamentDetail;

function renderRegister(overrides: Partial<TournamentDetail> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(qk.tournament("t1"), { ...TOURNAMENT, ...overrides });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/t/t1/anmelden"]}>
        <Routes>
          <Route path="/t/:id/anmelden" element={<Register />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Walk steps 1–2 and land on the payment summary. */
async function fillForm(user: ReturnType<typeof userEvent.setup>, teamName = "Falcons") {
  await user.click(screen.getByRole("button", { name: /Junioren D/ }));
  await user.type(screen.getByLabelText("Teamname"), teamName);
  await user.type(screen.getByLabelText("Kontaktperson"), "Anna Muster");
  await user.type(screen.getByLabelText("E-Mail"), "anna@test.ch");
  await user.type(screen.getByLabelText("Telefon"), "079 000 00 00");
  await user.click(screen.getByRole("button", { name: "Weiter" }));
}

beforeEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
  // jsdom has no navigation; the redirect to Stripe is asserted, not performed.
  vi.stubGlobal("location", { ...window.location, assign: vi.fn() });
});

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

describe("Register", () => {
  it("shows the fee once, prominently", async () => {
    renderRegister();
    expect(screen.getByText("Startgeld: CHF 100.–")).toBeInTheDocument();
  });

  it("redirects to Stripe with the entered team and contact", async () => {
    const create = vi.spyOn(regApi, "createRegistration").mockResolvedValue({
      registrationId: "reg_1",
      checkoutUrl: "https://checkout.stripe.test/session",
    });
    const user = userEvent.setup();
    renderRegister();

    await fillForm(user);
    await user.click(screen.getByRole("button", { name: "Weiter zur Zahlung" }));

    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0][0]).toEqual({
      tournamentId: "t1",
      categoryId: "c1",
      teamName: "Falcons",
      contactName: "Anna Muster",
      contactEmail: "anna@test.ch",
      contactPhone: "079 000 00 00",
    });
    await waitFor(() =>
      expect(window.location.assign).toHaveBeenCalledWith("https://checkout.stripe.test/session"),
    );
  });

  it("renders TEAM_NAME_TAKEN at the field, not as a toast", async () => {
    vi.spyOn(regApi, "createRegistration").mockRejectedValue(
      new ApiError(409, "TEAM_NAME_TAKEN", "This team name is already taken in this category"),
    );
    const user = userEvent.setup();
    renderRegister();

    await fillForm(user);
    await user.click(screen.getByRole("button", { name: "Weiter zur Zahlung" }));

    // Back on the form, with the message where the fix is.
    const field = await screen.findByLabelText("Teamname");
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(
      screen.getByText("Dieser Teamname ist in dieser Kategorie bereits vergeben."),
    ).toBeInTheDocument();
    expect(field).toHaveValue("Falcons");
  });

  it("keeps the form when the payer comes back from a cancelled checkout", async () => {
    const user = userEvent.setup();
    const { unmount } = renderRegister();
    await fillForm(user);

    // Stripe's cancel_url returns here as a *fresh page load*, not a client-side
    // navigation — so the component remounts and only sessionStorage survives.
    unmount();
    renderRegister();

    // Straight back to the summary, not to step one with an empty form.
    expect(await screen.findByRole("button", { name: "Weiter zur Zahlung" })).toBeInTheDocument();
    expect(screen.getByText("Falcons")).toBeInTheDocument();
    expect(screen.getByText("anna@test.ch")).toBeInTheDocument();
  });

  it("does not resurrect a draft from a different tournament", async () => {
    const user = userEvent.setup();
    const { unmount } = renderRegister();
    await fillForm(user);
    unmount();

    // A draft belongs to the tournament it was typed for.
    const draft = JSON.parse(sessionStorage.getItem("registration.draft.v1")!);
    sessionStorage.setItem(
      "registration.draft.v1",
      JSON.stringify({ ...draft, tournamentId: "other" }),
    );
    renderRegister();

    expect(screen.getByText("1. Kategorie wählen")).toBeInTheDocument();
  });

  it("blocks the step until the contact details are usable", async () => {
    const user = userEvent.setup();
    renderRegister();

    await user.click(screen.getByRole("button", { name: /Junioren D/ }));
    await user.type(screen.getByLabelText("Teamname"), "F"); // too short
    expect(screen.getByRole("button", { name: "Weiter" })).toBeDisabled();

    await user.type(screen.getByLabelText("Teamname"), "alcons");
    await user.type(screen.getByLabelText("Kontaktperson"), "Anna");
    await user.type(screen.getByLabelText("E-Mail"), "nope"); // malformed
    await user.type(screen.getByLabelText("Telefon"), "079");
    expect(screen.getByRole("button", { name: "Weiter" })).toBeDisabled();

    await user.clear(screen.getByLabelText("E-Mail"));
    await user.type(screen.getByLabelText("E-Mail"), "anna@test.ch");
    expect(screen.getByRole("button", { name: "Weiter" })).toBeEnabled();
  });

  it("states the state instead of a form when registration is closed", () => {
    renderRegister({ registrationOpen: false });

    expect(screen.getByText("Anmeldung geschlossen")).toBeInTheDocument();
    expect(screen.queryByText("1. Kategorie wählen")).not.toBeInTheDocument();
  });

  it("treats a passed deadline as closed", () => {
    renderRegister({ registrationDeadline: "2020-01-01T00:00:00.000Z" });

    expect(screen.getByText("Anmeldung geschlossen")).toBeInTheDocument();
  });

  it("does not offer a form the club has not configured a fee for", () => {
    renderRegister({ entryFeeRp: 0 });

    expect(screen.getByText("Anmeldung noch nicht bereit")).toBeInTheDocument();
  });
});
