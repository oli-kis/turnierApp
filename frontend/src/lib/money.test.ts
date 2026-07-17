import { describe, it, expect } from "vitest";
import { formatChf, inputToRappen, rappenToInput } from "./money";

/**
 * The fee is the one number in this app that is money, and it round-trips
 * through a text input on its way to Stripe. Binary floating point makes that
 * route lossy unless it is done exactly right.
 */

describe("formatChf", () => {
  it("uses the Swiss dash for whole francs", () => {
    expect(formatChf(10000)).toBe("CHF 100.–");
  });

  it("shows Rappen when there are any", () => {
    expect(formatChf(8550)).toBe("CHF 85.50");
    expect(formatChf(8505)).toBe("CHF 85.05");
  });

  it("formats zero", () => {
    expect(formatChf(0)).toBe("CHF 0.–");
  });
});

describe("inputToRappen", () => {
  it("converts whole francs", () => {
    expect(inputToRappen("100")).toBe(10000);
  });

  it("converts Rappen without a float error", () => {
    // parseFloat("85.50") * 100 === 8549.999999999999 — truncating gives 8549,
    // i.e. a club silently undercharged by a Rappen on every single team.
    expect(inputToRappen("85.50")).toBe(8550);
    expect(inputToRappen("100.10")).toBe(10010);
    expect(inputToRappen("0.07")).toBe(7);
  });

  it("accepts the comma a Swiss keyboard offers", () => {
    expect(inputToRappen("85,50")).toBe(8550);
  });

  it.each(["", "  ", "abc", "-5", "10.123", "1e3", "10.", ".5"])(
    "rejects %o rather than guessing",
    (input) => {
      expect(inputToRappen(input)).toBeNull();
    },
  );

  it("round-trips through the input field", () => {
    for (const rp of [0, 7, 500, 8550, 10000, 250000]) {
      const shown = rappenToInput(rp);
      if (rp === 0) {
        expect(shown).toBe("");
      } else {
        expect(inputToRappen(shown)).toBe(rp);
      }
    }
  });
});
