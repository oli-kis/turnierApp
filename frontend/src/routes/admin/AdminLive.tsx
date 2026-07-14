import { Link, useParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { forceReady } from "../../api/endpoints/matches";
import { startTournament, finishTournament } from "../../api/endpoints/tournaments";
import { useDashboard, useSlots, useTournament, qk } from "../../api/queries";
import { useTournamentEvents } from "../../api/sse";
import { Button } from "../../components/Button";
import { Tag, LiveTag } from "../../components/Tag";
import { ScoreCard } from "../../components/ScoreCard";
import { CardSkeleton } from "../../components/Skeleton";
import { EmptyState } from "../../components/EmptyState";
import { delayLabel } from "../../lib/time";
import type { DashboardSlot, DashboardSlotMatch } from "../../api/types";

export function AdminLive() {
  const { id } = useParams();
  useTournamentEvents(id);
  const { data: dashboard, isLoading } = useDashboard(id);
  const { data: slots } = useSlots(id);
  const { data: tournament } = useTournament(id);
  const qc = useQueryClient();

  const start = useMutation({
    mutationFn: () => startTournament(id!),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.dashboard(id!) }),
  });
  const finish = useMutation({
    mutationFn: () => finishTournament(id!),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.dashboard(id!) }),
  });

  const total = slots?.length ?? 0;
  const current = dashboard?.currentSlot;
  const delay = current ? delayLabel(current.plannedStart, current.estimatedStart) : "";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-[var(--color-line)] bg-white p-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-display text-xl font-extrabold">{tournament?.name ?? "Turnier"}</h1>
            <Tag tone={tournament?.status === "RUNNING" ? "live" : "neutral"}>{tournament?.status}</Tag>
          </div>
          <p className="mt-1 text-sm text-[var(--color-ink)]/70 tabular-nums">
            {current ? `Runde ${current.index + 1} von ${total}` : `${total} Runden`}
            {delay && <span className="ml-2 font-semibold text-[var(--color-live)]">{delay}</span>}
          </p>
        </div>
        <div className="flex gap-2">
          <Link to={`/admin/t/${id}/setup`} className="self-center text-sm font-semibold text-[var(--color-pine)]">
            Setup
          </Link>
          {tournament?.status === "SCHEDULED" && (
            <Button onClick={() => start.mutate()} disabled={start.isPending}>
              Turnier starten
            </Button>
          )}
          {tournament?.status === "RUNNING" && (
            <Button variant="secondary" onClick={() => finish.mutate()} disabled={finish.isPending}>
              Turnier beenden
            </Button>
          )}
        </div>
      </div>

      {isLoading ? (
        <CardSkeleton />
      ) : !current ? (
        <EmptyState
          title="Keine aktive Runde"
          hint={tournament?.status === "SCHEDULED" ? "Starte das Turnier oben." : "Alle Runden sind gespielt."}
        />
      ) : (
        <>
          <section>
            <h2 className="mb-3 font-display text-lg font-extrabold uppercase tracking-wide">Aktuelle Runde</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {current.matches.map((m) => (
                <PitchCard
                  key={m.matchId}
                  tournamentId={id!}
                  match={m}
                  slot={current}
                  matchDurationMin={tournament?.matchDurationMin ?? 12}
                />
              ))}
            </div>
          </section>

          {dashboard?.nextSlot && (
            <section>
              <h2 className="mb-3 font-display text-lg font-extrabold uppercase tracking-wide">Nächste Runde</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {dashboard.nextSlot.matches.map((m) => (
                  <NextPitchCard key={m.matchId} tournamentId={id!} match={m} />
                ))}
              </div>
            </section>
          )}

          {dashboard && dashboard.unassignedMatches.length > 0 && (
            <section>
              <h2 className="mb-2 font-display text-sm font-bold uppercase tracking-wide text-[var(--color-live)]">
                Ohne Schiedsrichter
              </h2>
              <div className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-live)] bg-white">
                {dashboard.unassignedMatches.map((m) => (
                  <Link
                    key={m.matchId}
                    to={`/admin/t/${id}/spiel/${m.matchId}`}
                    className="flex items-center justify-between border-b border-[var(--color-line)] px-4 py-2.5 text-sm last:border-b-0"
                  >
                    <span className="font-semibold">
                      {m.homeTeam ?? "—"} vs {m.awayTeam ?? "—"}
                    </span>
                    <span className="text-[var(--color-ink)]/60 tabular-nums">
                      Runde {(m.slotIndex ?? 0) + 1} · {m.pitch ?? "—"}
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function PitchCard({
  tournamentId,
  match,
  slot,
  matchDurationMin,
}: {
  tournamentId: string;
  match: DashboardSlotMatch;
  slot: DashboardSlot;
  matchDurationMin: number;
}) {
  const qc = useQueryClient();
  const force = useMutation({
    mutationFn: () => forceReady(match.matchId),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.dashboard(tournamentId) }),
  });

  const waiting = match.status === "SCHEDULED";
  const ready = match.status === "READY";

  // The ScoreCard IS the card (shared scoreboard identity); controls sit beneath
  // it, not in a wrapping card — no nesting.
  return (
    <div>
      <ScoreCard
        size="sm"
        pitch={match.pitch}
        homeTeam={match.homeTeam}
        awayTeam={match.awayTeam}
        scoreHome={match.scoreHome}
        scoreAway={match.scoreAway}
        status={match.status}
        actualStart={slot.actualStart}
        matchDurationMin={matchDurationMin}
      />
      <div className="mt-1.5 flex items-center justify-between px-1">
        <span className="truncate text-sm">
          {match.referee ? (
            <span className="text-[var(--color-ink)]/70">SR: {match.referee}</span>
          ) : (
            <span className="font-semibold text-[var(--color-live)]">Kein SR</span>
          )}
        </span>
        {match.status === "RUNNING" ? (
          <LiveTag />
        ) : ready ? (
          <Tag tone="win">Bereit</Tag>
        ) : waiting ? (
          <Button size="md" variant="live" onClick={() => force.mutate()} disabled={force.isPending}>
            Bereit setzen
          </Button>
        ) : (
          <Tag>{match.status}</Tag>
        )}
      </div>
    </div>
  );
}

function NextPitchCard({ tournamentId, match }: { tournamentId: string; match: DashboardSlotMatch }) {
  const gap = !match.referee;
  return (
    <Link
      to={`/admin/t/${tournamentId}/spiel/${match.matchId}`}
      className={[
        "block rounded-[var(--radius-card)] border bg-white p-3",
        gap ? "border-[var(--color-live)]" : "border-[var(--color-line)]",
      ].join(" ")}
    >
      <div className="text-xs font-semibold uppercase tracking-wide text-[var(--color-pine)]">
        {match.pitch ?? "—"}
      </div>
      <div className="font-semibold">
        {match.homeTeam ?? "—"} vs {match.awayTeam ?? "—"}
      </div>
      <div className={`mt-1 text-sm ${gap ? "font-semibold text-[var(--color-live)]" : "text-[var(--color-ink)]/60"}`}>
        {match.referee ? `SR: ${match.referee}` : "Kein Schiedsrichter — zuweisen"}
      </div>
    </Link>
  );
}
