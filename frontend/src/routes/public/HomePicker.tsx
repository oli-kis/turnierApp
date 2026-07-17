import { Link, Navigate } from "react-router-dom";
import { useTournaments } from "../../api/queries";
import { formatTime } from "../../lib/time";
import { Tag } from "../../components/Tag";
import { RegistrationCta } from "../../components/RegistrationCta";
import { CardSkeleton } from "../../components/Skeleton";
import { EmptyState, ErrorState } from "../../components/EmptyState";

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Entwurf",
  SCHEDULED: "Geplant",
  RUNNING: "Läuft",
  FINISHED: "Beendet",
};

/** Tournament picker. If exactly one is RUNNING, jump straight in. */
export function HomePicker() {
  const { data, isLoading, isError } = useTournaments();

  if (isLoading) {
    return (
      <Shell>
        <CardSkeleton />
        <CardSkeleton />
      </Shell>
    );
  }
  if (isError || !data) {
    return (
      <Shell>
        <ErrorState message="Turniere konnten nicht geladen werden." />
      </Shell>
    );
  }

  const running = data.filter((t) => t.status === "RUNNING");
  if (running.length === 1) {
    return <Navigate to={`/t/${running[0]!.id}`} replace />;
  }

  if (data.length === 0) {
    return (
      <Shell>
        <EmptyState title="Noch keine Turniere" hint="Die Turnierleitung legt bald los." />
      </Shell>
    );
  }

  return (
    <Shell>
      <ul className="space-y-3">
        {data.map((t) => (
          // The registration action is a sibling of the card, not inside it: the
          // card is already a link, and a link inside a link is invalid HTML
          // that browsers resolve by guessing.
          <li key={t.id} className="space-y-2">
            <Link
              to={`/t/${t.id}`}
              className="flex items-center justify-between rounded-[var(--radius-card)] border border-[var(--color-line)] bg-white p-4 hover:border-[var(--color-pine)]"
            >
              <div>
                <div className="font-display text-lg font-bold">{t.name}</div>
                <div className="text-sm text-[var(--color-ink)]/70 tabular-nums">
                  Start {formatTime(t.startAt)} · {t.pitchCount} Plätze
                </div>
              </div>
              <Tag tone={t.status === "RUNNING" ? "live" : "neutral"} pulse={t.status === "RUNNING"}>
                {STATUS_LABEL[t.status] ?? t.status}
              </Tag>
            </Link>
            <RegistrationCta tournament={t} compact />
          </li>
        ))}
      </ul>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-2xl p-4">
      <header className="mb-5 pt-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-pine)]">FC Frick</p>
        <h1 className="font-display text-3xl font-extrabold">Turniere</h1>
      </header>
      {children}
      <div className="mt-8 border-t border-[var(--color-line)] pt-4 text-center text-sm">
        <Link to="/ref" className="font-semibold text-[var(--color-pine)]">
          Schiedsrichter-Login →
        </Link>
      </div>
    </div>
  );
}
