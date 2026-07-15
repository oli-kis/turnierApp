import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createTournament, deleteTournament } from "../../api/endpoints/tournaments";
import { useTournaments, qk } from "../../api/queries";
import { Button, buttonClass } from "../../components/Button";
import { Sheet } from "../../components/Sheet";
import { Tag } from "../../components/Tag";
import { useToast } from "../../components/Toast";
import { CardSkeleton } from "../../components/Skeleton";
import { EmptyState } from "../../components/EmptyState";
import { formatTime } from "../../lib/time";
import type { Tournament } from "../../api/types";

const STATUS: Record<string, string> = {
  DRAFT: "Entwurf",
  SCHEDULED: "Geplant",
  RUNNING: "Läuft",
  FINISHED: "Beendet",
};

export function AdminList() {
  const { data, isLoading } = useTournaments();
  const [open, setOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Tournament | null>(null);
  const navigate = useNavigate();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-extrabold">Turniere</h1>
        <Button onClick={() => setOpen((o) => !o)}>{open ? "Schliessen" : "Neues Turnier"}</Button>
      </div>

      {open && <CreateForm onCreated={(id) => navigate(`/admin/t/${id}/setup`)} />}

      {isLoading ? (
        <CardSkeleton />
      ) : data && data.length > 0 ? (
        <ul className="space-y-3">
          {data.map((t) => (
            <li
              key={t.id}
              className="flex items-center justify-between rounded-[var(--radius-card)] border border-[var(--color-line)] bg-white p-4"
            >
              <div>
                <div className="font-display text-lg font-bold">{t.name}</div>
                <div className="text-sm text-[var(--color-ink)]/70 tabular-nums">
                  {formatTime(t.startAt)} · {t.pitchCount} Plätze · {t.matchDurationMin}+{t.transitionMin} min
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Tag tone={t.status === "RUNNING" ? "live" : "neutral"}>{STATUS[t.status] ?? t.status}</Tag>
                {/* The contextually relevant action is primary: Live while the
                    tournament runs, otherwise Setup. */}
                <Link
                  to={`/admin/t/${t.id}/setup`}
                  className={buttonClass(t.status === "RUNNING" ? "secondary" : "primary")}
                >
                  Setup
                </Link>
                <Link
                  to={`/admin/t/${t.id}/live`}
                  className={buttonClass(t.status === "RUNNING" ? "primary" : "secondary")}
                >
                  Live
                </Link>
                {t.status !== "RUNNING" && (
                  <Button variant="danger" onClick={() => setDeleteTarget(t)}>
                    Löschen
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="Noch keine Turniere" hint="Erstelle das erste Turnier." />
      )}

      <DeleteDialog target={deleteTarget} onClose={() => setDeleteTarget(null)} />
    </div>
  );
}

/** Typed-confirmation delete — destroying a whole tournament day needs more than OK. */
function DeleteDialog({ target, onClose }: { target: Tournament | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [confirm, setConfirm] = useState("");

  const close = () => {
    setConfirm("");
    onClose();
  };

  const del = useMutation({
    mutationFn: (id: string) => deleteTournament(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.tournaments() });
      toast.show("Turnier gelöscht", "success");
      close();
    },
  });

  if (!target) return null;
  const match = confirm.trim() === target.name;

  return (
    <Sheet open={!!target} onClose={close} title="Turnier löschen">
      <p className="mb-3 text-sm text-[var(--color-ink)]/70">
        Das löscht <b>alle</b> Daten dieses Turniers (Kategorien, Teams, Spiele, Resultate) unwiderruflich.
        Tippe zur Bestätigung den Turniernamen <b>{target.name}</b>.
      </p>
      <input
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        placeholder={target.name}
        autoFocus
        className="mb-3 w-full rounded-lg border border-[var(--color-line)] px-3 py-2"
      />
      <div className="flex gap-3">
        <Button variant="secondary" className="flex-1" onClick={close}>
          Abbrechen
        </Button>
        <Button
          variant="danger"
          className="flex-1"
          disabled={!match || del.isPending}
          onClick={() => del.mutate(target.id)}
        >
          Endgültig löschen
        </Button>
      </div>
    </Sheet>
  );
}

function CreateForm({ onCreated }: { onCreated: (id: string) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [startAt, setStartAt] = useState("");
  const [matchDurationMin, setDur] = useState(12);
  const [transitionMin, setTrans] = useState(3);
  const [pitchCount, setPitch] = useState(2);

  const create = useMutation({
    mutationFn: () =>
      createTournament({
        name,
        startAt: new Date(startAt).toISOString(),
        matchDurationMin,
        transitionMin,
        pitchCount,
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: qk.tournaments() });
      onCreated(res.tournament.id);
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };

  return (
    <form onSubmit={submit} className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-white p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <NumOrText label="Name" value={name} onChange={setName} className="sm:col-span-2" />
        <label className="block">
          <span className="mb-1 block text-sm font-semibold">Start</span>
          <input
            type="datetime-local"
            value={startAt}
            onChange={(e) => setStartAt(e.target.value)}
            className="w-full rounded-lg border border-[var(--color-line)] px-3 py-2"
          />
        </label>
        <NumOrText label="Plätze" value={pitchCount} onChange={(v) => setPitch(Number(v))} type="number" />
        <NumOrText label="Spieldauer (min)" value={matchDurationMin} onChange={(v) => setDur(Number(v))} type="number" />
        <NumOrText label="Wechselzeit (min)" value={transitionMin} onChange={(v) => setTrans(Number(v))} type="number" />
      </div>
      <Button type="submit" className="mt-4 w-full" disabled={create.isPending || !name || !startAt}>
        Turnier erstellen
      </Button>
    </form>
  );
}

function NumOrText({
  label,
  value,
  onChange,
  type = "text",
  className = "",
}: {
  label: string;
  value: string | number;
  onChange: (v: string) => void;
  type?: string;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-sm font-semibold">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-[var(--color-line)] px-3 py-2"
      />
    </label>
  );
}
