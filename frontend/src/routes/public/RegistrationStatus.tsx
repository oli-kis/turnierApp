import { useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useRegistrationStatus } from "../../api/queries";
import { clearRegistrationDraft } from "./Register";
import { buttonClass } from "../../components/Button";
import { CardSkeleton } from "../../components/Skeleton";
import { ErrorState } from "../../components/EmptyState";

/**
 * Where Stripe drops the payer after checkout.
 *
 * The catch this page exists for: the browser redirect regularly *beats* the
 * webhook that records the payment. So arriving here with PENDING_PAYMENT means
 * "not yet", never "failed" — and saying anything final at that moment would be
 * a lie told to someone whose money has already left. We poll and wait.
 */

/** How long we keep waiting before offering a way out. Spec: 2 s × 60 s. */
const MAX_WAIT_MS = 60_000;

export function RegistrationStatus() {
  const { id: tournamentId } = useParams();
  const [params] = useSearchParams();
  const rid = params.get("rid");

  const [timedOut, setTimedOut] = useState(false);
  const startedAt = useRef(Date.now());

  const { data, isLoading, error } = useRegistrationStatus(
    rid ?? undefined,
    // Poll only while there is something to wait for.
    !timedOut && (!rid ? false : true),
  );

  const settled = data?.status === "PAID" || data?.status === "CANCELED" || data?.status === "EXPIRED";

  useEffect(() => {
    if (settled) return;
    const t = setInterval(() => {
      if (Date.now() - startedAt.current > MAX_WAIT_MS) setTimedOut(true);
    }, 1000);
    return () => clearInterval(t);
  }, [settled]);

  // The team is in; the draft has done its job.
  useEffect(() => {
    if (data?.status === "PAID") clearRegistrationDraft();
  }, [data?.status]);

  if (!rid) {
    return (
      <Shell>
        <ErrorState message="Keine Anmeldung angegeben." />
        <BackLink tournamentId={tournamentId} />
      </Shell>
    );
  }

  if (isLoading) {
    return (
      <Shell>
        <CardSkeleton />
      </Shell>
    );
  }

  if (error || !data) {
    return (
      <Shell>
        <ErrorState message="Status konnte nicht geladen werden." />
        <RetryLink tournamentId={tournamentId} />
      </Shell>
    );
  }

  if (data.status === "PAID") {
    return (
      <Shell>
        <div className="rounded-[var(--radius-card)] border border-[var(--color-win)] bg-white p-6 text-center">
          <p className="font-display text-2xl font-extrabold leading-tight">
            <strong>{data.teamName}</strong> ist angemeldet!
          </p>
          <p className="mt-2 text-[var(--color-ink)]/70">
            Kategorie {data.categoryName}. Die Bestätigung geht per E-Mail raus.
          </p>
          <p className="mt-1 text-[var(--color-ink)]/70">
            Der Spielplan folgt später auf dieser Website.
          </p>
        </div>
        <Link to={`/t/${tournamentId}`} className={buttonClass("primary", "lg", "w-full")}>
          Zum Turnier
        </Link>
      </Shell>
    );
  }

  if (data.status === "PENDING_PAYMENT" && !timedOut) {
    return (
      <Shell>
        <div className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-white p-6 text-center">
          <p className="font-display text-xl font-extrabold">Zahlung wird bestätigt…</p>
          <p className="mt-2 text-[var(--color-ink)]/70">
            Das dauert nur einen Moment. Bitte dieses Fenster offen lassen.
          </p>
        </div>
      </Shell>
    );
  }

  // Still pending after a minute. The payment may yet land — so this must not
  // claim failure; it offers the club's desk rather than a retry that could
  // charge them twice.
  if (data.status === "PENDING_PAYMENT") {
    return (
      <Shell>
        <div className="rounded-[var(--radius-card)] border border-[var(--color-live)] bg-white p-6">
          <p className="font-display text-xl font-extrabold">Bestätigung dauert länger</p>
          <p className="mt-2 text-[var(--color-ink)]/70">
            Falls die Zahlung ausgelöst wurde, ist sie unterwegs — {data.teamName} wird angemeldet,
            sobald sie ankommt. Die Seite lässt sich später mit demselben Link neu laden.
          </p>
          <p className="mt-2 text-[var(--color-ink)]/70">
            Bitte nicht nochmals bezahlen. Bei Fragen: die Turnierleitung hilft weiter.
          </p>
        </div>
        <BackLink tournamentId={tournamentId} />
      </Shell>
    );
  }

  if (data.status === "EXPIRED") {
    return (
      <Shell>
        <div className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-white p-6">
          <p className="font-display text-xl font-extrabold">Zeit abgelaufen</p>
          <p className="mt-2 text-[var(--color-ink)]/70">
            Die Reservation für {data.teamName} ist verfallen und es wurde nichts belastet. Der
            Teamname ist wieder frei.
          </p>
        </div>
        <RetryLink tournamentId={tournamentId} />
      </Shell>
    );
  }

  // CANCELED — most likely the name-collision refund.
  return (
    <Shell>
      <div className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-white p-6">
        <p className="font-display text-xl font-extrabold">Anmeldung nicht abgeschlossen</p>
        <p className="mt-2 text-[var(--color-ink)]/70">
          {data.teamName} konnte nicht angemeldet werden. Falls bereits bezahlt wurde, wird das
          Startgeld vollständig zurückerstattet — die Details stehen im E-Mail.
        </p>
      </div>
      <RetryLink tournamentId={tournamentId} />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-lg space-y-4 p-4">{children}</div>;
}

function RetryLink({ tournamentId }: { tournamentId?: string }) {
  return (
    <Link to={`/t/${tournamentId}/anmelden`} className={buttonClass("primary", "lg", "w-full")}>
      Nochmals anmelden
    </Link>
  );
}

function BackLink({ tournamentId }: { tournamentId?: string }) {
  return (
    <Link to={`/t/${tournamentId}`} className={buttonClass("secondary", "lg", "w-full")}>
      Zum Turnier
    </Link>
  );
}
