import { Link } from "react-router-dom";
import { buttonClass } from "./Button";
import { isRegistrationOpen, showsRegistrationEntry } from "../lib/registration";
import { formatChf } from "../lib/money";
import { formatDate } from "../lib/time";
import type { Tournament } from "../api/types";

/**
 * „Team anmelden" — the club's entry-fee funnel, on the tournament home and the
 * picker.
 *
 * Deliberately near the top, unlike `InstallPrompt`: this one pays for the
 * tournament, and a coach who cannot find it phones the club instead. Placing it
 * above the scores is safe by construction — the schedule cannot be generated
 * while registration is open, and a tournament cannot run without a schedule, so
 * an open registration and a live score never coexist on this page.
 *
 * When it is closed it says so rather than vanishing: a missing button reads as
 * a broken site, which produces the same phone call.
 */
export function RegistrationCta({
  tournament,
  compact = false,
}: {
  tournament: Tournament;
  compact?: boolean;
}) {
  if (!showsRegistrationEntry(tournament)) return null;

  const open = isRegistrationOpen(tournament);

  if (!open) {
    return (
      <p
        className={[
          "rounded-[var(--radius-card)] border border-[var(--color-line)] bg-white px-4 py-3 font-semibold text-[var(--color-ink)]/60",
          compact ? "text-sm" : "",
        ].join(" ")}
      >
        Anmeldung geschlossen
      </p>
    );
  }

  const deadline = tournament.registrationDeadline;

  if (compact) {
    return (
      <Link
        to={`/t/${tournament.id}/anmelden`}
        className={buttonClass("primary", "md", "w-full")}
      >
        Team anmelden
      </Link>
    );
  }

  return (
    <section className="rounded-[var(--radius-card)] border border-[var(--color-pine)] bg-white p-4">
      <h2 className="font-display text-lg font-extrabold">Team anmelden</h2>
      <p className="mt-1 text-[var(--color-ink)]/70">
        Startgeld {formatChf(tournament.entryFeeRp)} — Zahlung per TWINT oder Karte.
        {deadline ? ` Anmeldeschluss: ${formatDate(deadline)}.` : ""}
      </p>
      <Link
        to={`/t/${tournament.id}/anmelden`}
        className={buttonClass("primary", "lg", "mt-3 w-full")}
      >
        Jetzt anmelden
      </Link>
    </section>
  );
}
