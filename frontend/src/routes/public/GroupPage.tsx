import { useParams } from "react-router-dom";
import { useMatches, useStandings, useTournament } from "../../api/queries";
import { StandingsTable } from "../../components/StandingsTable";
import { MatchRow } from "../../components/MatchRow";
import { TableSkeleton } from "../../components/Skeleton";
import { EmptyState } from "../../components/EmptyState";

export function GroupPage() {
  const { id, groupId } = useParams();
  const { data: tournament } = useTournament(id);
  const { data: standings, isLoading: standingsLoading } = useStandings(groupId);
  const { data: matches, isLoading: matchesLoading } = useMatches(id, { groupId });

  const category = tournament?.categories?.find((c) => c.groups?.some((g) => g.id === groupId));
  const group = category?.groups?.find((g) => g.id === groupId);

  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-pine)]">
          {category?.name ?? "Gruppe"}
        </p>
        <h2 className="font-display text-2xl font-extrabold">{group?.name ?? "Gruppe"}</h2>
      </div>

      <section>
        {standingsLoading ? (
          <TableSkeleton />
        ) : standings && standings.standings.length > 0 ? (
          <>
            <StandingsTable rows={standings.standings} qualifiersPerGroup={category?.qualifiersPerGroup} />
            {standings.tieUnresolved && (
              <p className="mt-2 text-sm font-semibold text-[var(--color-live)]">
                Punktgleichheit — Rang wird von der Turnierleitung entschieden.
              </p>
            )}
          </>
        ) : (
          <EmptyState title="Noch keine Tabelle" hint="Sobald Spiele beendet sind." />
        )}
      </section>

      <section>
        <h3 className="mb-2 font-display text-lg font-extrabold uppercase tracking-wide">Spiele</h3>
        {matchesLoading ? (
          <TableSkeleton />
        ) : matches && matches.length > 0 ? (
          <div className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-line)] bg-white">
            {matches.map((m) => (
              <MatchRow
                key={m.id}
                homeTeam={m.homeTeam?.name}
                awayTeam={m.awayTeam?.name}
                scoreHome={m.scoreHome}
                scoreAway={m.scoreAway}
                status={m.status}
                pitch={m.pitch?.name}
                estimatedStart={m.estimatedStart}
                plannedStart={m.slot?.plannedStart}
                tournamentStatus={tournament?.status}
              />
            ))}
          </div>
        ) : (
          <EmptyState title="Noch keine Spiele angesetzt" />
        )}
      </section>
    </div>
  );
}
