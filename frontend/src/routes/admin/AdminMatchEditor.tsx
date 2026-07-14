import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { updateMatch, correctResult } from "../../api/endpoints/matches";
import { useMatch, useSlots, useTournament, useReferees, qk } from "../../api/queries";
import { useToast } from "../../components/Toast";
import { Button } from "../../components/Button";
import { Sheet } from "../../components/Sheet";
import { CardSkeleton } from "../../components/Skeleton";
import { ErrorState } from "../../components/EmptyState";
import { PHASE_LABEL } from "../../lib/matchState";

const CONFIRM_WORD = "KORRIGIEREN";

export function AdminMatchEditor() {
  const { id, matchId } = useParams();
  const { data: match, isLoading, isError } = useMatch(matchId);
  const { data: tournament } = useTournament(id);
  const { data: slots } = useSlots(id);
  const { data: referees } = useReferees("APPROVED");
  const qc = useQueryClient();
  const toast = useToast();

  const [correctOpen, setCorrectOpen] = useState(false);

  const assign = useMutation({
    mutationFn: (body: { pitchId?: string | null; slotId?: string | null; refereeId?: string | null }) =>
      updateMatch(matchId!, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.match(matchId!) });
      qc.invalidateQueries({ queryKey: qk.dashboard(id!) });
      toast.show("Gespeichert", "success");
    },
  });

  if (isLoading) return <CardSkeleton />;
  if (isError || !match) return <ErrorState message="Spiel konnte nicht geladen werden." />;

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <Link to={`/admin/t/${id}/live`} className="text-sm font-semibold text-[var(--color-pine)]">
          ← Live-Dashboard
        </Link>
        <h1 className="mt-1 font-display text-2xl font-extrabold">
          {match.homeTeam?.name ?? "—"} vs {match.awayTeam?.name ?? "—"}
        </h1>
        <p className="text-sm text-[var(--color-ink)]/60">{PHASE_LABEL[match.phase]}</p>
      </div>

      {/* Assignment */}
      <section className="space-y-3 rounded-[var(--radius-card)] border border-[var(--color-line)] bg-white p-4">
        <h2 className="font-display font-bold">Zuweisung</h2>

        <SelectRow
          label="Platz"
          value={match.pitch?.id ?? ""}
          onChange={(v) => assign.mutate({ pitchId: v || null })}
          options={[
            { value: "", label: "— kein Platz —" },
            ...(tournament?.pitches ?? []).map((p) => ({ value: p.id, label: p.name })),
          ]}
        />
        <SelectRow
          label="Runde"
          value={match.slot?.id ?? ""}
          onChange={(v) => assign.mutate({ slotId: v || null })}
          options={[
            { value: "", label: "— aus Runde entfernen —" },
            ...(slots ?? []).map((s) => ({ value: s.id, label: `Runde ${s.index + 1} (${s.status})` })),
          ]}
        />
        <SelectRow
          label="Schiedsrichter"
          value={match.refereeId ?? ""}
          onChange={(v) => assign.mutate({ refereeId: v || null })}
          options={[
            { value: "", label: "— kein SR —" },
            ...(referees ?? []).map((r) => ({ value: r.id, label: r.name })),
          ]}
        />
      </section>

      {/* Result correction */}
      <section className="space-y-3 rounded-[var(--radius-card)] border border-[var(--color-line)] bg-white p-4">
        <h2 className="font-display font-bold">Resultat</h2>
        <p className="font-score text-2xl">
          {match.scoreHome} : {match.scoreAway}
          {match.pensHome != null && match.pensAway != null ? (
            <span className="ml-2 text-base text-[var(--color-ink)]/60">
              ({match.pensHome}:{match.pensAway} n.E.)
            </span>
          ) : null}
        </p>
        <Button variant="secondary" onClick={() => setCorrectOpen(true)}>
          Resultat korrigieren
        </Button>
      </section>

      <CorrectionSheet
        open={correctOpen}
        onClose={() => setCorrectOpen(false)}
        matchId={matchId!}
        tournamentId={id!}
        initialHome={match.scoreHome}
        initialAway={match.scoreAway}
      />
    </div>
  );
}

function SelectRow({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="text-sm font-semibold">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-w-0 flex-1 rounded-lg border border-[var(--color-line)] px-3 py-2"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function CorrectionSheet({
  open,
  onClose,
  matchId,
  tournamentId,
  initialHome,
  initialAway,
}: {
  open: boolean;
  onClose: () => void;
  matchId: string;
  tournamentId: string;
  initialHome: number;
  initialAway: number;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [home, setHome] = useState(initialHome);
  const [away, setAway] = useState(initialAway);
  const [confirm, setConfirm] = useState("");

  const correct = useMutation({
    mutationFn: () => correctResult(matchId, { scoreHome: home, scoreAway: away }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.match(matchId) });
      qc.invalidateQueries({ queryKey: ["standings"] });
      qc.invalidateQueries({ queryKey: qk.dashboard(tournamentId) });
      toast.show("Resultat korrigiert", "success");
      onClose();
      setConfirm("");
    },
  });

  return (
    <Sheet open={open} onClose={onClose} title="Resultat korrigieren">
      <p className="mb-3 text-sm text-[var(--color-ink)]/70">
        Nachträgliche Korrektur wird protokolliert. Tippe <b>{CONFIRM_WORD}</b> zum Bestätigen.
      </p>
      <div className="mb-3 flex items-center justify-center gap-3">
        <input
          type="number"
          value={home}
          min={0}
          onChange={(e) => setHome(Math.max(0, Number(e.target.value)))}
          className="w-20 rounded-lg border border-[var(--color-line)] px-3 py-2 text-center font-score text-2xl"
        />
        <span className="font-score text-2xl">:</span>
        <input
          type="number"
          value={away}
          min={0}
          onChange={(e) => setAway(Math.max(0, Number(e.target.value)))}
          className="w-20 rounded-lg border border-[var(--color-line)] px-3 py-2 text-center font-score text-2xl"
        />
      </div>
      <input
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        placeholder={CONFIRM_WORD}
        className="mb-3 w-full rounded-lg border border-[var(--color-line)] px-3 py-2"
      />
      <Button
        variant="danger"
        size="lg"
        className="w-full"
        disabled={confirm !== CONFIRM_WORD || correct.isPending}
        onClick={() => correct.mutate()}
      >
        Korrektur speichern
      </Button>
    </Sheet>
  );
}
