import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { approveReferee, rejectReferee, deleteReferee } from "../../api/endpoints/admin";
import { useReferees } from "../../api/queries";
import { ApiError } from "../../api/client";
import { Button } from "../../components/Button";
import { Sheet } from "../../components/Sheet";
import { Tag } from "../../components/Tag";
import { CardSkeleton } from "../../components/Skeleton";
import { EmptyState } from "../../components/EmptyState";
import type { Referee } from "../../api/types";

type Filter = "PENDING" | "APPROVED" | "REJECTED";
const LABEL: Record<Filter, string> = { PENDING: "Ausstehend", APPROVED: "Freigegeben", REJECTED: "Abgelehnt" };

interface BlockingMatch {
  id: string;
  tournamentId: string;
  homeTeam: string | null;
  awayTeam: string | null;
}

export function AdminReferees() {
  const [filter, setFilter] = useState<Filter>("PENDING");
  const { data, isLoading } = useReferees(filter);
  const qc = useQueryClient();

  const [confirmTarget, setConfirmTarget] = useState<Referee | null>(null);
  const [blockers, setBlockers] = useState<BlockingMatch[] | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["referees"] });
  const approve = useMutation({ mutationFn: approveReferee, onSuccess: invalidate });
  const reject = useMutation({ mutationFn: rejectReferee, onSuccess: invalidate });
  const del = useMutation({
    mutationFn: deleteReferee,
    onSuccess: () => {
      invalidate();
      setConfirmTarget(null);
    },
    onError: (err) => {
      setConfirmTarget(null);
      if (err instanceof ApiError && err.code === "REFEREE_HAS_ASSIGNMENTS") {
        const matches = (err.details as { matches?: BlockingMatch[] } | undefined)?.matches ?? [];
        setBlockers(matches);
      }
    },
  });

  return (
    <div className="space-y-5">
      <h1 className="font-display text-2xl font-extrabold">Schiedsrichter</h1>

      <div className="flex gap-2">
        {(Object.keys(LABEL) as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={[
              "rounded-full px-3 py-2 text-sm font-semibold",
              f === filter ? "bg-[var(--color-pine)] text-white" : "border border-[var(--color-line)] bg-white",
            ].join(" ")}
          >
            {LABEL[f]}
          </button>
        ))}
      </div>

      {isLoading ? (
        <CardSkeleton />
      ) : data && data.length > 0 ? (
        <ul className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-line)] bg-white">
          {data.map((r) => (
            <li
              key={r.id}
              className="flex items-center justify-between gap-3 border-b border-[var(--color-line)] px-4 py-3 last:border-b-0"
            >
              <div className="min-w-0">
                <div className="truncate font-semibold">{r.name}</div>
                <div className="truncate text-sm text-[var(--color-ink)]/60">{r.email}</div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {filter === "PENDING" ? (
                  <>
                    <Button size="md" onClick={() => approve.mutate(r.id)} disabled={approve.isPending}>
                      Freigeben
                    </Button>
                    <Button size="md" variant="secondary" onClick={() => reject.mutate(r.id)} disabled={reject.isPending}>
                      Ablehnen
                    </Button>
                  </>
                ) : (
                  <Tag tone={r.status === "APPROVED" ? "win" : "loss"}>{LABEL[r.status as Filter]}</Tag>
                )}
                <Button size="md" variant="danger" onClick={() => setConfirmTarget(r)}>
                  Löschen
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title={`Keine ${LABEL[filter].toLowerCase()}en Schiedsrichter`} />
      )}

      {/* Confirm delete */}
      <Sheet open={!!confirmTarget} onClose={() => setConfirmTarget(null)} title="Schiedsrichter löschen">
        <p className="mb-4 text-sm text-[var(--color-ink)]/70">
          <b>{confirmTarget?.name}</b> wird entfernt. Bereits gespielte Spiele bleiben erhalten, zeigen aber „unbekannt“
          als Schiedsrichter.
        </p>
        <div className="flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={() => setConfirmTarget(null)}>
            Abbrechen
          </Button>
          <Button
            variant="danger"
            className="flex-1"
            disabled={del.isPending}
            onClick={() => confirmTarget && del.mutate(confirmTarget.id)}
          >
            Löschen
          </Button>
        </div>
      </Sheet>

      {/* Blocked by open assignments */}
      <Sheet open={!!blockers} onClose={() => setBlockers(null)} title="Noch zugewiesen">
        <p className="mb-3 text-sm text-[var(--color-ink)]/70">
          Weise diese Spiele zuerst einem anderen Schiedsrichter zu, dann kann gelöscht werden.
        </p>
        <ul className="mb-4 space-y-2">
          {(blockers ?? []).map((m) => (
            <li key={m.id}>
              <Link
                to={`/admin/t/${m.tournamentId}/spiel/${m.id}`}
                onClick={() => setBlockers(null)}
                className="flex items-center justify-between rounded-lg border border-[var(--color-line)] px-3 py-2 text-sm font-semibold hover:border-[var(--color-pine)]"
              >
                <span>
                  {m.homeTeam ?? "—"} vs {m.awayTeam ?? "—"}
                </span>
                <span className="text-[var(--color-pine)]">Zuweisen →</span>
              </Link>
            </li>
          ))}
        </ul>
        <Button variant="secondary" className="w-full" onClick={() => setBlockers(null)}>
          Schliessen
        </Button>
      </Sheet>
    </div>
  );
}
