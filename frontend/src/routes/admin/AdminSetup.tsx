import { useState, type ReactNode, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { updateTournament } from "../../api/endpoints/tournaments";
import { generateSchedule } from "../../api/endpoints/structure";
import { useTournament, useSlots, qk } from "../../api/queries";
import { useToast } from "../../components/Toast";
import { Button } from "../../components/Button";
import { Sheet } from "../../components/Sheet";
import { CardSkeleton } from "../../components/Skeleton";
import { StructureSection } from "./StructureSection";
import { RefereeAssignmentSection } from "./RefereeAssignmentSection";
import type { RestStats } from "../../api/types";

export function AdminSetup() {
  const { id } = useParams();
  const { data: tournament, isLoading } = useTournament(id);
  const { data: slots } = useSlots(id);

  if (isLoading || !tournament) return <CardSkeleton />;

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

      <Section n={2} title="Kategorien, Gruppen & Teams">
        <StructureSection tournamentId={id!} categories={tournament.categories ?? []} />
      </Section>

      <Section n={3} title="Schiedsrichter zuweisen">
        <RefereeAssignmentSection tournamentId={id!} />
      </Section>

      <Section n={4} title="Spielplan">
        <ScheduleSection tournamentId={id!} slotCount={slots?.length ?? 0} />
      </Section>
    </div>
  );
}

function Section({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-chalk)] p-4">
      <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-extrabold">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--color-pine)] text-sm text-white">
          {n}
        </span>
        {title}
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
  tournament: { name: string; startAt: string; matchDurationMin: number; transitionMin: number; pitchCount: number };
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(tournament.name);
  const [startAt, setStartAt] = useState(toLocalInput(tournament.startAt));
  const [dur, setDur] = useState(tournament.matchDurationMin);
  const [trans, setTrans] = useState(tournament.transitionMin);
  const [pitch, setPitch] = useState(tournament.pitchCount);

  const save = useMutation({
    mutationFn: () =>
      updateTournament(tournamentId, {
        name,
        startAt: new Date(startAt).toISOString(),
        matchDurationMin: dur,
        transitionMin: trans,
        pitchCount: pitch,
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
      <div className="sm:col-span-2">
        <Button type="submit" disabled={save.isPending}>
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

  return (
    <div className="space-y-3">
      <p className="text-sm text-[var(--color-ink)]/70">
        {slotCount > 0
          ? `Spielplan vorhanden: ${slotCount} Runden. Neu erstellen ersetzt den bestehenden Plan (nur vor dem Start).`
          : "Erstellt den Rundenplan aus allen Gruppen. Die Pausen-Statistik wird danach angezeigt."}
      </p>
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

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-white p-3">
      <div className="font-score text-2xl">{value}</div>
      <div className="text-xs text-[var(--color-ink)]/60">{label}</div>
    </div>
  );
}
