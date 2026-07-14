import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getTeamMatches } from "../../api/endpoints/public";
import { qk } from "../../api/queries";
import { MatchRow } from "../../components/MatchRow";
import { PHASE_LABEL } from "../../lib/matchState";
import { TableSkeleton } from "../../components/Skeleton";
import { EmptyState } from "../../components/EmptyState";

/**
 * The page parents bookmark: a team's whole day, chronological, each row with
 * estimated (live-ish) time, pitch, opponent, result. Standalone route — no
 * tournament SSE context, so it polls to keep estimated times fresh. Built to
 * be perfect at 360px.
 */
export function TeamPage() {
  const { teamId } = useParams();
  const { data, isLoading } = useQuery({
    queryKey: qk.teamMatches(teamId ?? ""),
    queryFn: () => getTeamMatches(teamId!).then((r) => r.matches),
    enabled: !!teamId,
    refetchInterval: 15_000,
  });

  return (
    <div className="mx-auto min-h-dvh max-w-md p-4">
      <Link to=".." className="text-sm font-semibold text-[var(--color-pine)]">
        ← Zurück
      </Link>
      <h1 className="mb-4 mt-2 font-display text-2xl font-extrabold">Spielplan</h1>

      {isLoading ? (
        <TableSkeleton rows={5} />
      ) : data && data.length > 0 ? (
        <div className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-line)] bg-white">
          {data.map((m) => (
            <div key={m.id}>
              {m.phase !== "GROUP" && (
                <div className="bg-[var(--color-chalk)] px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-[var(--color-ink)]/60">
                  {PHASE_LABEL[m.phase]}
                </div>
              )}
              <MatchRow
                homeTeam={m.homeTeam}
                awayTeam={m.awayTeam}
                scoreHome={m.scoreHome}
                scoreAway={m.scoreAway}
                status={m.status}
                pitch={m.pitch}
                estimatedStart={m.estimatedStart}
              />
            </div>
          ))}
        </div>
      ) : (
        <EmptyState title="Keine Spiele" hint="Für dieses Team ist noch nichts angesetzt." />
      )}
    </div>
  );
}
