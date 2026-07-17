import { useState, type ReactNode, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { updateTournament } from "../../api/endpoints/tournaments";
import { generateSchedule } from "../../api/endpoints/structure";
import { ApiError } from "../../api/client";
import { useTournament, useSlots, useRegistrations, qk } from "../../api/queries";
import { useTournamentEvents } from "../../api/sse";
import { useToast } from "../../components/Toast";
import { Button } from "../../components/Button";
import { Sheet } from "../../components/Sheet";
import { CardSkeleton } from "../../components/Skeleton";
import { StructureSection } from "./StructureSection";
import { RefereeAssignmentSection } from "./RefereeAssignmentSection";
import { RegistrationsSection } from "./RegistrationsSection";
import { formatChf, inputToRappen, rappenToInput } from "../../lib/money";
import type { RestStats, Tournament } from "../../api/types";

export function AdminSetup() {
  const { id } = useParams();
  const { data: tournament, isLoading } = useTournament(id);
  const { data: slots } = useSlots(id);
  const { data: registrations } = useRegistrations(id);
  // Registrations arrive while the admin is on this page, so the list and the
  // unassigned-team pool have to update themselves (`registration.paid`).
  useTournamentEvents(id);

  if (isLoading || !tournament) return <CardSkeleton />;

  const paidCount = registrations?.filter((r) => r.status === "PAID").length ?? 0;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-extrabold">{tournament.name} — Setup</h1>
        <Link to={`/admin/t/${id}/live`} className="text-sm font-semibold text-[var(--color-pine)]">
          Live-Dashboard →
        </Link>
      </div>

      <Section n={1} title="Grunddaten">
        <GrunddatenForm tournamentId={id!} tournament={tournament} />
      </Section>

      <Section n={2} title="Anmeldungen" badge={paidCount || undefined}>
        <RegistrationsSection tournamentId={id!} />
      </Section>

      <Section n={3} title="Kategorien, Gruppen & Teams">
        <StructureSection tournamentId={id!} categories={tournament.categories ?? []} />
      </Section>

      <Section n={4} title="Schiedsrichter zuweisen">
        <RefereeAssignmentSection tournamentId={id!} />
      </Section>

      <Section n={5} title="Spielplan">
        <ScheduleSection tournamentId={id!} slotCount={slots?.length ?? 0} />
      </Section>
    </div>
  );
}

function Section({
  n,
  title,
  badge,
  children,
}: {
  n: number;
  title: string;
  badge?: number;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-chalk)] p-4">
      <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-extrabold">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--color-pine)] text-sm text-white">
          {n}
        </span>
        {title}
        {badge !== undefined && (
          <span className="rounded-full bg-[var(--color-pine)]/10 px-2 py-0.5 text-sm font-bold tabular-nums text-[var(--color-pine)]">
            {badge}
          </span>
        )}
      </h2>
      {children}
    </section>
  );
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function GrunddatenForm({
  tournamentId,
  tournament,
}: {
  tournamentId: string;
  tournament: Tournament;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(tournament.name);
  const [startAt, setStartAt] = useState(toLocalInput(tournament.startAt));
  const [dur, setDur] = useState(tournament.matchDurationMin);
  const [trans, setTrans] = useState(tournament.transitionMin);
  const [pitch, setPitch] = useState(tournament.pitchCount);
  // The fee is typed in francs and stored in Rappen; see lib/money.
  const [fee, setFee] = useState(() => rappenToInput(tournament.entryFeeRp));
  const [regOpen, setRegOpen] = useState(tournament.registrationOpen);
  const [deadline, setDeadline] = useState(
    tournament.registrationDeadline ? toLocalInput(tournament.registrationDeadline) : "",
  );

  const feeRp = inputToRappen(fee);
  const feeInvalid = fee.trim() !== "" && feeRp === null;
  // Opening registration with no fee would let a team reach a checkout the
  // backend refuses (REGISTRATION_NOT_CONFIGURED). Catch it at the field.
  const openWithoutFee = regOpen && (feeRp ?? 0) <= 0;

  const save = useMutation({
    mutationFn: () =>
      updateTournament(tournamentId, {
        name,
        startAt: new Date(startAt).toISOString(),
        matchDurationMin: dur,
        transitionMin: trans,
        pitchCount: pitch,
        entryFeeRp: feeRp ?? 0,
        registrationOpen: regOpen,
        registrationDeadline: deadline ? new Date(deadline).toISOString() : null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.tournament(tournamentId) });
      toast.show("Grunddaten gespeichert", "success");
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
      <Labeled label="Name" className="sm:col-span-2">
        <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
      </Labeled>
      <Labeled label="Start">
        <input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} className={inputCls} />
      </Labeled>
      <Labeled label="Plätze">
        <input type="number" min={1} value={pitch} onChange={(e) => setPitch(Number(e.target.value))} className={inputCls} />
      </Labeled>
      <Labeled label="Spieldauer (min)">
        <input type="number" min={1} value={dur} onChange={(e) => setDur(Number(e.target.value))} className={inputCls} />
      </Labeled>
      <Labeled label="Wechselzeit (min)">
        <input type="number" min={0} value={trans} onChange={(e) => setTrans(Number(e.target.value))} className={inputCls} />
      </Labeled>

      <fieldset className="grid gap-3 border-t border-[var(--color-line)] pt-3 sm:col-span-2 sm:grid-cols-2">
        <legend className="sr-only">Anmeldung</legend>
        <Labeled label="Startgeld (CHF)">
          <input
            inputMode="decimal"
            placeholder="z. B. 100"
            value={fee}
            onChange={(e) => setFee(e.target.value)}
            aria-invalid={feeInvalid || undefined}
            className={inputCls}
          />
          {feeInvalid ? (
            <span className="mt-1 block text-sm font-semibold text-[var(--color-loss)]">
              Betrag in Franken, z. B. 100 oder 85.50
            </span>
          ) : (
            <span className="mt-1 block text-sm text-[var(--color-ink)]/60">
              {(feeRp ?? 0) > 0 ? `Teams zahlen ${formatChf(feeRp!)}` : "Leer = keine Anmeldung"}
            </span>
          )}
        </Labeled>
        <Labeled label="Anmeldeschluss (optional)">
          <input
            type="datetime-local"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            className={inputCls}
          />
          <span className="mt-1 block text-sm text-[var(--color-ink)]/60">
            Leer = kein Schluss, nur der Schalter zählt.
          </span>
        </Labeled>
        <label className="flex items-start gap-3 sm:col-span-2">
          <input
            type="checkbox"
            checked={regOpen}
            onChange={(e) => setRegOpen(e.target.checked)}
            className="mt-1 h-5 w-5 shrink-0"
          />
          <span>
            <span className="block font-semibold">Anmeldung offen</span>
            <span className="block text-sm text-[var(--color-ink)]/60">
              Teams können sich selbst anmelden und bezahlen. Muss geschlossen sein, bevor der
              Spielplan erstellt werden kann.
            </span>
            {openWithoutFee && (
              <span className="mt-1 block text-sm font-semibold text-[var(--color-loss)]">
                Ohne Startgeld kann sich niemand anmelden — zuerst einen Betrag setzen.
              </span>
            )}
          </span>
        </label>
      </fieldset>

      <div className="sm:col-span-2">
        <Button type="submit" disabled={save.isPending || feeInvalid || openWithoutFee}>
          Speichern
        </Button>
      </div>
    </form>
  );
}

const inputCls = "w-full rounded-lg border border-[var(--color-line)] px-3 py-2";

function Labeled({ label, className = "", children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-sm font-semibold">{label}</span>
      {children}
    </label>
  );
}

function ScheduleSection({ tournamentId, slotCount }: { tournamentId: string; slotCount: number }) {
  const qc = useQueryClient();
  const [stats, setStats] = useState<{ slots: number; matches: number; restStats: RestStats } | null>(null);

  const generate = useMutation({
    mutationFn: () => generateSchedule(tournamentId),
    onSuccess: (res) => {
      setStats(res);
      qc.invalidateQueries({ queryKey: qk.slots(tournamentId) });
      qc.invalidateQueries({ queryKey: qk.tournament(tournamentId) });
      qc.invalidateQueries({ queryKey: qk.matchLists(tournamentId) });
    },
  });

  /**
   * The two registration guards are not errors so much as unfinished steps, so
   * they render as instructions with the fix in them — not a toast that scrolls
   * away from the button that caused it.
   */
  const blocker = registrationBlocker(generate.error);

  return (
    <div className="space-y-3">
      <p className="text-sm text-[var(--color-ink)]/70">
        {slotCount > 0
          ? `Spielplan vorhanden: ${slotCount} Runden. Neu erstellen ersetzt den bestehenden Plan (nur vor dem Start).`
          : "Erstellt den Rundenplan aus allen Gruppen. Die Pausen-Statistik wird danach angezeigt."}
      </p>

      {blocker && (
        <div
          role="alert"
          className="rounded-[var(--radius-card)] border border-[var(--color-live)] bg-white p-3"
        >
          <p className="font-semibold">{blocker.message}</p>
          {blocker.teams && (
            <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm">
              {blocker.teams.map((t) => (
                <li key={t.id}>{t.name}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <Button onClick={() => generate.mutate()} disabled={generate.isPending}>
        {slotCount > 0 ? "Spielplan neu erstellen" : "Spielplan erstellen"}
      </Button>

      <Sheet open={!!stats} onClose={() => setStats(null)} title="Spielplan erstellt">
        {stats && (
          <div className="space-y-4">
            <p className="text-[var(--color-ink)]/70">
              {stats.slots} Runden · {stats.matches} Spiele generiert.
            </p>
            <div className="grid grid-cols-3 gap-3 text-center">
              <Stat label="Min. Pause" value={stats.restStats.min} />
              <Stat label="Ø Pause" value={stats.restStats.avg} />
              <Stat label="Max. Pause" value={stats.restStats.max} />
            </div>
            <p className="text-xs text-[var(--color-ink)]/60">Pause = Runden zwischen zwei Spielen eines Teams.</p>
            <Button size="lg" className="w-full" onClick={() => setStats(null)}>
              Übernehmen
            </Button>
          </div>
        )}
      </Sheet>
    </div>
  );
}

interface Blocker {
  message: string;
  teams?: Array<{ id: string; name: string }>;
}

/**
 * Turn the two registration-related 409s into something the admin can act on.
 *
 * Both mean "a step is missing", not "something broke": the schedule cannot be
 * fixed while teams can still buy their way in, and a paid team with no group
 * would be silently left out of the fixtures it paid for.
 */
function registrationBlocker(error: unknown): Blocker | null {
  if (!(error instanceof ApiError)) return null;
  if (error.code === "REGISTRATION_STILL_OPEN") {
    return { message: "Anmeldung ist noch offen — zuerst unter Grunddaten schliessen." };
  }
  if (error.code === "UNASSIGNED_TEAMS") {
    const teams = (error.details as { teams?: Array<{ id: string; name: string }> } | undefined)
      ?.teams;
    const n = teams?.length ?? 0;
    return {
      message: `${n} ${n === 1 ? "Team ist" : "Teams sind"} noch keiner Gruppe zugeteilt — unter „Kategorien, Gruppen & Teams“ zuweisen.`,
      teams,
    };
  }
  return null;
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-white p-3">
      <div className="font-score text-2xl">{value}</div>
      <div className="text-xs text-[var(--color-ink)]/60">{label}</div>
    </div>
  );
}
