import { Link, useParams } from "react-router-dom";
import { useMatches, useSlots, useTournament } from "../../api/queries";
import { ScoreCard } from "../../components/ScoreCard";
import { CardSkeleton, Skeleton } from "../../components/Skeleton";
import { EmptyState } from "../../components/EmptyState";
import { Tag } from "../../components/Tag";
import { formatSlotTime, delayLabel } from "../../lib/time";
import type { MatchListItem, Slot } from "../../api/types";

export function TournamentHome() {
  const { id } = useParams();
  const { data: tournament } = useTournament(id);
  const { data: slots, isLoading: slotsLoading } = useSlots(id);
  const { data: matches, isLoading: matchesLoading } = useMatches(id);

  const duration = tournament?.matchDurationMin ?? 12;
  const runningSlot = slots?.find((s) => s.status === "RUNNING");
  const nextSlot =
    slots?.find((s) => s.status === "WAITING_READY") ??
    (runningSlot
      ? slots?.find((s) => s.index === runningSlot.index + 1)
      : slots?.find((s) => s.status === "PENDING"));

  const inSlot = (slot: Slot | undefined) =>
    slot && matches ? matches.filter((m) => m.slot?.index === slot.index) : [];

  const running = inSlot(runningSlot);
  const upcoming = inSlot(nextSlot);
  const loading = slotsLoading || matchesLoading;

  return (
    <div className="space-y-8">
      {/* Jetzt läuft */}
      <section>
        <SectionHeader title="Jetzt läuft" live={!!runningSlot} />
        {loading ? (
          <div className="space-y-3">
            <CardSkeleton />
            <CardSkeleton />
          </div>
        ) : running.length > 0 ? (
          <div className="space-y-3">
            {running.map((m) => (
              <ScoreCard
                key={m.id}
                size="md"
                pitch={m.pitch?.name}
                homeTeam={m.homeTeam?.name}
                awayTeam={m.awayTeam?.name}
                scoreHome={m.scoreHome}
                scoreAway={m.scoreAway}
                status={m.status}
                actualStart={runningSlot?.actualStart}
                matchDurationMin={duration}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            title="Gerade läuft kein Spiel"
            hint={nextSlot ? "Das nächste Spiel steht unten." : "Bald geht es los."}
          />
        )}
      </section>

      {/* Als Nächstes */}
      {nextSlot && (
        <section>
          <div className="mb-2 flex items-center justify-between">
            <SectionHeader title="Als Nächstes" />
            <NextTime slot={nextSlot} />
          </div>
          {upcoming.length > 0 ? (
            <div className="divide-y divide-[var(--color-line)] overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-line)] bg-white">
              {upcoming.map((m) => (
                <UpcomingRow key={m.id} match={m} />
              ))}
            </div>
          ) : (
            <Skeleton className="h-16 w-full" />
          )}
        </section>
      )}

      {/* Kategorien */}
      <section>
        <SectionHeader title="Kategorien" />
        {tournament?.categories && tournament.categories.length > 0 ? (
          <ul className="grid grid-cols-2 gap-3">
            {tournament.categories.map((c) => (
              <li key={c.id}>
                <Link
                  to={`/t/${id}/kategorie/${c.id}`}
                  className="block rounded-[var(--radius-card)] border border-[var(--color-line)] bg-white p-4 font-display text-lg font-bold hover:border-[var(--color-pine)]"
                >
                  {c.name}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="Noch keine Kategorien" />
        )}
      </section>
    </div>
  );
}

function SectionHeader({ title, live }: { title: string; live?: boolean }) {
  return (
    <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-extrabold uppercase tracking-wide">
      {title}
      {live && <span className="h-2.5 w-2.5 rounded-full bg-[var(--color-live)] animate-ready-pulse" />}
    </h2>
  );
}

function NextTime({ slot }: { slot: Slot }) {
  const delay = delayLabel(slot.plannedStart, slot.estimatedStart);
  return (
    <div className="text-right">
      <div className="text-sm font-semibold tabular-nums">{formatSlotTime(slot.plannedStart, slot.estimatedStart)}</div>
      {delay && <div className="text-xs font-semibold text-[var(--color-live)]">{delay}</div>}
    </div>
  );
}

function UpcomingRow({ match }: { match: MatchListItem }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <div className="truncate font-semibold">{match.homeTeam?.name ?? "—"}</div>
        <div className="truncate font-semibold">{match.awayTeam?.name ?? "—"}</div>
      </div>
      {match.pitch && <Tag>{match.pitch.name}</Tag>}
    </div>
  );
}
