import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The URLs Stripe sends the payer back to.
 *
 * These are built from a hand-edited `.env` value, so the shapes people
 * actually write — with and without a trailing slash — must both produce a
 * valid URL. A malformed return URL is a payer who paid and then landed on a
 * broken page, which reads exactly like a failed payment.
 */

const created: Array<Record<string, unknown>> = [];

vi.mock("stripe", () => {
  class FakeStripe {
    checkout = {
      sessions: {
        create: async (params: Record<string, unknown>) => {
          created.push(params);
          return { id: "cs_test_fake", url: "https://checkout.stripe.test/x" };
        },
      },
    };
  }
  return { default: FakeStripe };
});

async function createSessionWith(baseUrl: string) {
  vi.resetModules();
  process.env.PUBLIC_BASE_URL = baseUrl;
  process.env.STRIPE_SECRET_KEY = "sk_test_dummy_for_tests";
  const { createCheckoutSession } = await import("../../src/services/stripeService.js");
  await createCheckoutSession({
    registrationId: "reg_1",
    tournamentId: "t_1",
    tournamentName: "Frick Cup",
    categoryName: "Junioren D",
    amountRp: 10000,
    contactEmail: "anna@test.ch",
    expiresAt: new Date(Date.now() + 30 * 60_000),
  });
  return created.at(-1)!;
}

beforeEach(() => {
  created.length = 0;
});

describe("checkout return URLs", () => {
  it("builds clean URLs from a base without a trailing slash", async () => {
    const params = await createSessionWith("https://turnier.fcfrick.ch");

    expect(params.success_url).toBe(
      "https://turnier.fcfrick.ch/t/t_1/anmeldung/status?rid=reg_1",
    );
    expect(params.cancel_url).toBe("https://turnier.fcfrick.ch/t/t_1/anmelden");
  });

  it("tolerates a trailing slash rather than emitting a double slash", async () => {
    const params = await createSessionWith("https://turnier.fcfrick.ch/");

    // "https://…ch//t/t_1/…" is what naive concatenation produces, and it is the
    // natural way to paste a URL into .env.
    expect(params.success_url).toBe(
      "https://turnier.fcfrick.ch/t/t_1/anmeldung/status?rid=reg_1",
    );
    expect(params.success_url).not.toContain("//t/");
    expect(params.cancel_url).toBe("https://turnier.fcfrick.ch/t/t_1/anmelden");
  });

  it("charges the snapshot amount in CHF, with TWINT offered first", async () => {
    const params = await createSessionWith("https://turnier.fcfrick.ch");

    expect(params.payment_method_types).toEqual(["twint", "card"]);
    expect(params.mode).toBe("payment");
    const items = params.line_items as Array<{ price_data: Record<string, unknown> }>;
    expect(items[0].price_data).toMatchObject({ currency: "chf", unit_amount: 10000 });
    // The webhook's only handle back to us.
    expect(params.metadata).toEqual({ registrationId: "reg_1" });
  });
});
