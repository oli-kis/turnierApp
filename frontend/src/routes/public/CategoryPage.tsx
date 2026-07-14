import { Link, useParams } from "react-router-dom";
import { useBracket, useStandings, useTournament } from "../../api/queries";
import { StandingsTable } from "../../components/StandingsTable";
import { BracketTree } from "../../components/BracketTree";
import { TableSkeleton } from "../../components/Skeleton";
import { EmptyState } from "../../components/EmptyState";

export function CategoryPage() {
  const { id, catId } = useParams();
  const { data: tournament } = useTournament(id);
  const category = tournament?.categories?.find((c) => c.id === catId);
  const { data: bracket } = useBracket(catId);

  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-pine)]">Kategorie</p>
        <h2 className="font-display text-2xl font-extrabold">{category?.name ?? "…"}</h2>
      </div>

      <section className="space-y-6">
        {category?.groups && category.groups.length > 0 ? (
          category.groups.map((g) => (
            <GroupStandingsCard
              key={g.id}
              tournamentId={id!}
              groupId={g.id}
              name={g.name}
              qualifiersPerGroup={category.qualifiersPerGroup}
            />
          ))
        ) : (
          <EmptyState title="Noch keine Gruppen" />
        )}
      </section>

      {bracket && bracket.generated && (
        <section>
          <h3 className="mb-3 font-display text-xl font-extrabold uppercase tracking-wide">K.-o.-Runde</h3>
          <BracketTree bracket={bracket} />
        </section>
      )}
    </div>
  );
}

function GroupStandingsCard({
  tournamentId,
  groupId,
  name,
  qualifiersPerGroup,
}: {
  tournamentId: string;
  groupId: string;
  name: string;
  qualifiersPerGroup?: number | null;
}) {
  const { data, isLoading } = useStandings(groupId);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-display text-lg font-bold">{name}</h3>
        <Link
          to={`/t/${tournamentId}/gruppe/${groupId}`}
          className="text-sm font-semibold text-[var(--color-pine)]"
        >
          Alle Spiele →
        </Link>
      </div>
      {isLoading ? (
        <TableSkeleton rows={3} />
      ) : data && data.standings.length > 0 ? (
        <StandingsTable rows={data.standings} qualifiersPerGroup={qualifiersPerGroup} />
      ) : (
        <EmptyState title="Noch keine Tabelle" hint="Sobald Spiele beendet sind." />
      )}
    </div>
  );
}
