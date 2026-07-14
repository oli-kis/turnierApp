import { useMutation, useQueryClient } from "@tanstack/react-query";
import { updateMatch } from "../../api/endpoints/matches";
import { useMatches, useReferees, useSlots, qk } from "../../api/queries";
import { EmptyState } from "../../components/EmptyState";
import { PHASE_LABEL } from "../../lib/matchState";
import type { MatchListItem } from "../../api/types";

/** Per-slot referee assignment; the backend rejects one-referee-per-slot clashes. */
export function RefereeAssignmentSection({ tournamentId }: { tournamentId: string }) {
  const { data: slots } = useSlots(tournamentId);
  const { data: matches } = useMatches(tournamentId);
  const { data: referees } = useReferees("APPROVED");
  const qc = useQueryClient();

  const assign = useMutation({
    mutationFn: ({ matchId, refereeId }: { matchId: string; refereeId: string | null }) =>
      updateMatch(matchId, { refereeId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.matchLists(tournamentId) }),
  });

  if (!slots || slots.length === 0) {
    return <EmptyState title="Noch kein Spielplan" hint="Erstelle zuerst den Spielplan (unten)." />;
  }

  const bySlot = new Map<number, MatchListItem[]>();
  for (const m of matches ?? []) {
    if (m.slot) bySlot.set(m.slot.index, [...(bySlot.get(m.slot.index) ?? []), m]);
  }

  return (
    <div className="space-y-4">
      {[...bySlot.keys()]
        .sort((a, b) => a - b)
        .map((idx) => (
          <div key={idx} className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-white p-3">
            <h4 className="mb-2 text-sm font-bold uppercase tracking-wide text-[var(--color-ink)]/60">
              Runde {idx + 1}
            </h4>
            <div className="space-y-2">
              {bySlot.get(idx)!.map((m) => (
                <div key={m.id} className="flex items-center justify-between gap-3">
                  <div className="min-w-0 text-sm">
                    <span className="font-semibold">
                      {m.homeTeam?.name ?? "—"} vs {m.awayTeam?.name ?? "—"}
                    </span>
                    <span className="ml-2 text-[var(--color-ink)]/50">
                      {m.pitch?.name ?? ""} · {PHASE_LABEL[m.phase]}
                    </span>
                  </div>
                  <select
                    defaultValue=""
                    onChange={(e) => assign.mutate({ matchId: m.id, refereeId: e.target.value || null })}
                    className="shrink-0 rounded-lg border border-[var(--color-line)] px-2 py-1.5 text-sm"
                  >
                    <option value="">— SR wählen —</option>
                    {(referees ?? []).map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>
        ))}
    </div>
  );
}
