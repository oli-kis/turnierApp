/**
 * Money is Rappen (integers) everywhere except the moment it is shown or typed.
 *
 * Floats never touch a fee: `100.10 * 100` is `10009.999...`, and rounding that
 * the wrong way undercharges a club by a Rappen forever. The conversions live
 * here so there is exactly one place to be right.
 */

/** „CHF 100.–" / „CHF 85.50" — Swiss convention: whole francs use the dash. */
export function formatChf(amountRp: number): string {
  const francs = Math.trunc(amountRp / 100);
  const rappen = Math.abs(amountRp % 100);
  return rappen === 0
    ? `CHF ${francs}.–`
    : `CHF ${francs}.${String(rappen).padStart(2, "0")}`;
}

/** Rappen → the value of a CHF input field ("100" / "85.50"). */
export function rappenToInput(amountRp: number): string {
  return amountRp === 0 ? "" : (amountRp / 100).toFixed(2);
}

/**
 * A typed CHF amount → Rappen, or null when it isn't a usable amount.
 *
 * Accepts a comma as the decimal separator: a Swiss keyboard's numeric block
 * offers a comma, and „85,50" is what people type.
 */
export function inputToRappen(value: string): number | null {
  const trimmed = value.trim().replace(",", ".");
  if (trimmed === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  // Rounded, not truncated: parseFloat("85.50") * 100 is 8549.999... in binary.
  return Math.round(parseFloat(trimmed) * 100);
}
