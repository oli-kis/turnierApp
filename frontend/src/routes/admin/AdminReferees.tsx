import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { approveReferee, rejectReferee } from "../../api/endpoints/admin";
import { useReferees } from "../../api/queries";
import { Button } from "../../components/Button";
import { Tag } from "../../components/Tag";
import { CardSkeleton } from "../../components/Skeleton";
import { EmptyState } from "../../components/EmptyState";

type Filter = "PENDING" | "APPROVED" | "REJECTED";
const LABEL: Record<Filter, string> = { PENDING: "Ausstehend", APPROVED: "Freigegeben", REJECTED: "Abgelehnt" };

export function AdminReferees() {
  const [filter, setFilter] = useState<Filter>("PENDING");
  const { data, isLoading } = useReferees(filter);
  const qc = useQueryClient();

  const invalidate = () => qc.invalidateQueries({ queryKey: ["referees"] });
  const approve = useMutation({ mutationFn: approveReferee, onSuccess: invalidate });
  const reject = useMutation({ mutationFn: rejectReferee, onSuccess: invalidate });

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
              {filter === "PENDING" ? (
                <div className="flex shrink-0 gap-2">
                  <Button size="md" onClick={() => approve.mutate(r.id)} disabled={approve.isPending}>
                    Freigeben
                  </Button>
                  <Button size="md" variant="secondary" onClick={() => reject.mutate(r.id)} disabled={reject.isPending}>
                    Ablehnen
                  </Button>
                </div>
              ) : (
                <Tag tone={r.status === "APPROVED" ? "win" : "loss"}>{LABEL[r.status as Filter]}</Tag>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title={`Keine ${LABEL[filter].toLowerCase()}en Schiedsrichter`} />
      )}
    </div>
  );
}
