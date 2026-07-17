import type { Tournament } from "../api/types";

/**
 * Is registration open right now?
 *
 * Mirrors the backend rule (`registrationService.isRegistrationOpen`). The
 * server is the authority — it re-checks on every POST — but the UI has to
 * decide what to *show*, and „Anmeldung geschlossen" is a state to render, not
 * an error to wait for.
 */
export function isRegistrationOpen(
  t: Pick<Tournament, "registrationOpen" | "registrationDeadline" | "status">,
  now: Date = new Date(),
): boolean {
  if (!t.registrationOpen) return false;
  if (!t.registrationDeadline) return true;
  return now < new Date(t.registrationDeadline);
}

/**
 * Should the „Team anmelden" entry point appear at all?
 *
 * A finished tournament never shows it — „Anmeldung geschlossen" on last year's
 * tournament is noise, not information. Anything still to come shows the button,
 * open or not: the spec is explicit that a closed registration states its state
 * rather than hiding, because a coach who can't find the button phones the club.
 */
export function showsRegistrationEntry(
  t: Pick<Tournament, "registrationOpen" | "registrationDeadline" | "status" | "entryFeeRp">,
): boolean {
  if (t.status === "FINISHED") return false;
  // Never configured: no fee means the club is not collecting entries here, and
  // an entry point that can only say "not ready" helps nobody.
  if (t.entryFeeRp <= 0) return false;
  return true;
}
