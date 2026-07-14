import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as ref from "../../api/endpoints/referee";
import { listMatches } from "../../api/endpoints/matches";
import { ApiError } from "../../api/client";
import { useMatch, useTournament, qk } from "../../api/queries";
import { useTournamentEvents } from "../../api/sse";
import { useToast } from "../../components/Toast";
import { Button } from "../../components/Button";
import { Sheet } from "../../components/Sheet";
import { LiveClock } from "../../components/LiveClock";
import { OfflineBanner, useOnline } from "../../components/OfflineBanner";
import { CardSkeleton } from "../../components/Skeleton";
import { ErrorState } from "../../components/EmptyState";
import { PHASE_LABEL } from "../../lib/matchState";
import { formatTime } from "../../lib/time";
import { isKnockout } from "../../lib/matchState";
import type { MatchDetail } from "../../api/types";

export function RefereeMatch() {
  const { id } = useParams();
  const { data: match, isLoading, isError } = useMatch(id);
  useTournamentEvents(match?.tournamentId);
  const online = useOnline();

  return (
    <div className="flex min-h-[calc(100dvh-57px)] flex-col">
      <OfflineBanner show={!online} />
      <div className="border-b border-[var(--color-line)] px-4 py-2">
        <Link to="/ref" className="text-sm font-semibold text-[var(--color-pine)]">
          ← Meine Spiele
        </Link>
      </div>

      {isLoading ? (
        <div className="p-4">
          <CardSkeleton />
        </div>
      ) : isError || !match || !id ? (
        <div className="p-4">
          <ErrorState message="Spiel konnte nicht geladen werden." />
        </div>
      ) : match.status === "RUNNING" ? (
        <RunningPhase match={match} matchId={id} />
      ) : match.status === "FINISHED" ? (
        <FinishedView match={match} />
      ) : (
        <WaitingPhase match={match} matchId={id} />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- Waiting */

function WaitingPhase({ match, matchId }: { match: MatchDetail; matchId: string }) {
  const qc = useQueryClient();
  const slotWaiting = match.slot?.status === "WAITING_READY";
  const isReady = match.status === "READY";

  const readyMut = useMutation({
    mutationFn: () => ref.ready(matchId),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.match(matchId) }),
  });
  const unreadyMut = useMutation({
    mutationFn: () => ref.unready(matchId),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.match(matchId) }),
  });

  return (
    <div className="flex flex-1 flex-col justify-between p-5">
      <div className="pt-6 text-center">
        <p className="text-sm font-semibold uppercase tracking-wide text-[var(--color-pine)]">
          {match.pitch?.name ?? "—"} · {PHASE_LABEL[match.phase]}
        </p>
        <div className="mt-6 space-y-2">
          <p className="font-display text-4xl font-extrabold leading-tight">{match.homeTeam?.name ?? "—"}</p>
          <p className="text-lg font-semibold text-[var(--color-ink)]/50">gegen</p>
          <p className="font-display text-4xl font-extrabold leading-tight">{match.awayTeam?.name ?? "—"}</p>
        </div>
        <p className="mt-6 text-[var(--color-ink)]/70 tabular-nums">
          Geplanter Start {formatTime(match.slot?.estimatedStart ?? match.slot?.plannedStart)}
        </p>
      </div>

      <div className="pb-4">
        {!slotWaiting ? (
          <p className="text-center font-semibold text-[var(--color-ink)]/60">
            Noch nicht dran — warte, bis die Runde startet.
          </p>
        ) : isReady ? (
          <div className="space-y-3">
            <div className="rounded-[var(--radius-card)] border border-[var(--color-win)] bg-white p-4 text-center">
              <p className="font-display text-xl font-extrabold text-[var(--color-win)]">Bereit ✓</p>
              <SlotReadyCounter match={match} />
            </div>
            <Button
              variant="secondary"
              size="lg"
              className="w-full"
              onClick={() => unreadyMut.mutate()}
              disabled={unreadyMut.isPending}
            >
              Doch nicht bereit
            </Button>
          </div>
        ) : (
          <Button
            variant="primary"
            size="xl"
            className="w-full text-xl"
            onClick={() => readyMut.mutate()}
            disabled={readyMut.isPending}
          >
            Beide Teams bereit
          </Button>
        )}
      </div>
    </div>
  );
}

/** Live n/m ready counter across the slot (polls; the window is short). */
function SlotReadyCounter({ match }: { match: MatchDetail }) {
  const slotIndex = match.slot?.index;
  const { data } = useQuery({
    queryKey: [...qk.matchLists(match.tournamentId ?? ""), "slotReady", slotIndex],
    queryFn: () => listMatches(match.tournamentId!).then((r) => r.matches),
    enabled: !!match.tournamentId && slotIndex != null,
    refetchInterval: 4000,
  });
  if (!data || slotIndex == null) return null;
  const inSlot = data.filter((m) => m.slot?.index === slotIndex);
  const ready = inSlot.filter((m) => m.status === "READY").length;
  return (
    <p className="mt-1 text-sm font-semibold text-[var(--color-ink)]/70 tabular-nums">
      Warten auf andere Plätze — {ready}/{inSlot.length} bereit
    </p>
  );
}

/* ---------------------------------------------------------------- Running */

function RunningPhase({ match, matchId }: { match: MatchDetail; matchId: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: tournament } = useTournament(match.tournamentId);
  const duration = tournament?.matchDurationMin ?? 12;
  const [disabledSide, setDisabledSide] = useState<"home" | "away" | null>(null);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [penaltyOpen, setPenaltyOpen] = useState(false);

  const addGoal = useMutation({
    mutationFn: (teamId: string) => ref.addGoal(matchId, teamId),
    onMutate: async (teamId) => {
      await qc.cancelQueries({ queryKey: qk.match(matchId) });
      const prev = qc.getQueryData<MatchDetail>(qk.match(matchId));
      qc.setQueryData<MatchDetail>(qk.match(matchId), (old) =>
        old
          ? {
              ...old,
              scoreHome: teamId === old.homeTeamId ? old.scoreHome + 1 : old.scoreHome,
              scoreAway: teamId === old.awayTeamId ? old.scoreAway + 1 : old.scoreAway,
            }
          : old,
      );
      return { prev };
    },
    onError: (err, _teamId, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk.match(matchId), ctx.prev);
      toast.show(err instanceof ApiError ? err.message : "Tor konnte nicht gespeichert werden", "error");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.match(matchId) }),
  });

  const deleteGoal = useMutation({
    mutationFn: (goalId: string) => ref.deleteGoal(goalId),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.match(matchId) }),
  });

  const finish = useMutation({
    mutationFn: () => ref.finishMatch(matchId),
    onSuccess: () => {
      setConfirmFinish(false);
      qc.invalidateQueries({ queryKey: qk.match(matchId) });
    },
    onError: (err) => {
      setConfirmFinish(false);
      if (err instanceof ApiError && err.code === "PENALTIES_REQUIRED") {
        setPenaltyOpen(true);
      }
    },
  });

  const tap = (side: "home" | "away", teamId: string | null | undefined) => {
    if (!teamId || disabledSide) return;
    setDisabledSide(side);
    setTimeout(() => setDisabledSide(null), 400); // guard against double-taps
    addGoal.mutate(teamId);
  };

  return (
    <div className="flex flex-1 flex-col">
      {/* Scoreboard header */}
      <div className="flex items-center justify-center gap-4 border-b border-[var(--color-line)] py-3">
        <span className="text-sm font-semibold uppercase tracking-wide text-[var(--color-pine)]">
          {match.pitch?.name ?? "—"}
        </span>
        <LiveClock actualStart={match.slot?.actualStart} matchDurationMin={duration} className="text-3xl" />
      </div>

      {/* Two giant +1 zones */}
      <div className="grid flex-1 grid-cols-2">
        <GoalZone
          name={match.homeTeam?.name}
          score={match.scoreHome}
          disabled={disabledSide === "home"}
          onTap={() => tap("home", match.homeTeamId)}
        />
        <GoalZone
          name={match.awayTeam?.name}
          score={match.scoreAway}
          disabled={disabledSide === "away"}
          onTap={() => tap("away", match.awayTeamId)}
          rightBorder
        />
      </div>

      {/* Recent goals + finish */}
      <div className="border-t border-[var(--color-line)] p-3">
        {match.goals && match.goals.length > 0 && (
          <div className="mb-3 max-h-28 space-y-1 overflow-y-auto">
            {[...match.goals].reverse().map((g) => {
              const home = g.teamId === match.homeTeamId;
              return (
                <div
                  key={g.id}
                  className="flex items-center justify-between rounded border border-[var(--color-line)] px-3 py-1.5 text-sm"
                >
                  <span className="font-semibold">
                    Tor {home ? match.homeTeam?.name : match.awayTeam?.name}
                  </span>
                  <button
                    onClick={() => deleteGoal.mutate(g.id)}
                    className="font-semibold text-[var(--color-loss)]"
                  >
                    Löschen
                  </button>
                </div>
              );
            })}
          </div>
        )}
        <Button variant="danger" size="lg" className="w-full" onClick={() => setConfirmFinish(true)}>
          Spiel beenden
        </Button>
      </div>

      <Sheet open={confirmFinish} onClose={() => setConfirmFinish(false)} title="Spiel beenden?">
        <p className="mb-4 text-[var(--color-ink)]/70">
          Endstand {match.homeTeam?.name} {match.scoreHome} : {match.scoreAway} {match.awayTeam?.name}
        </p>
        <div className="flex gap-3">
          <Button variant="secondary" size="lg" className="flex-1" onClick={() => setConfirmFinish(false)}>
            Abbrechen
          </Button>
          <Button
            variant="danger"
            size="lg"
            className="flex-1"
            onClick={() => finish.mutate()}
            disabled={finish.isPending}
          >
            Beenden
          </Button>
        </div>
      </Sheet>

      <PenaltySheet
        open={penaltyOpen}
        onClose={() => setPenaltyOpen(false)}
        matchId={matchId}
        homeName={match.homeTeam?.name ?? "Heim"}
        awayName={match.awayTeam?.name ?? "Gast"}
      />
    </div>
  );
}

function GoalZone({
  name,
  score,
  disabled,
  onTap,
  rightBorder = false,
}: {
  name: string | null | undefined;
  score: number;
  disabled: boolean;
  onTap: () => void;
  rightBorder?: boolean;
}) {
  return (
    <button
      onClick={onTap}
      disabled={disabled}
      className={[
        "flex flex-col items-center justify-center gap-2 py-8 transition-[background-color,transform] duration-100 active:scale-[0.98] active:bg-[var(--color-pine)]/10",
        rightBorder ? "border-l border-[var(--color-line)]" : "",
        disabled ? "opacity-60" : "",
      ].join(" ")}
    >
      <span className="max-w-full truncate px-2 text-xl font-bold">{name ?? "—"}</span>
      <span key={score} className="font-score animate-score-tick text-8xl">
        {score}
      </span>
      <span className="rounded-full bg-[var(--color-pine)] px-4 py-1 text-sm font-bold text-white">+1 Tor</span>
    </button>
  );
}

function PenaltySheet({
  open,
  onClose,
  matchId,
  homeName,
  awayName,
}: {
  open: boolean;
  onClose: () => void;
  matchId: string;
  homeName: string;
  awayName: string;
}) {
  const qc = useQueryClient();
  const [home, setHome] = useState(0);
  const [away, setAway] = useState(0);
  const submit = useMutation({
    mutationFn: () => ref.submitPenalties(matchId, home, away),
    onSuccess: () => {
      onClose();
      qc.invalidateQueries({ queryKey: qk.match(matchId) });
    },
  });

  return (
    <Sheet open={open} onClose={onClose} title="Penaltyschiessen">
      <p className="mb-4 text-[var(--color-ink)]/70">Unentschieden — bitte das Penaltyresultat erfassen.</p>
      <div className="mb-4 grid grid-cols-2 gap-4">
        <Stepper label={homeName} value={home} onChange={setHome} />
        <Stepper label={awayName} value={away} onChange={setAway} />
      </div>
      {home === away && <p className="mb-3 text-sm font-semibold text-[var(--color-loss)]">Muss unterschiedlich sein.</p>}
      <Button
        variant="primary"
        size="lg"
        className="w-full"
        disabled={home === away || submit.isPending}
        onClick={() => submit.mutate()}
      >
        Speichern & beenden
      </Button>
    </Sheet>
  );
}

function Stepper({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-line)] p-3 text-center">
      <p className="mb-2 truncate text-sm font-semibold">{label}</p>
      <div className="flex items-center justify-center gap-3">
        <button
          onClick={() => onChange(Math.max(0, value - 1))}
          className="flex h-11 w-11 items-center justify-center rounded-full border border-[var(--color-line)] text-2xl font-bold"
          aria-label="weniger"
        >
          −
        </button>
        <span className="font-score w-8 text-3xl tabular-nums">{value}</span>
        <button
          onClick={() => onChange(value + 1)}
          className="flex h-11 w-11 items-center justify-center rounded-full border border-[var(--color-line)] text-2xl font-bold"
          aria-label="mehr"
        >
          +
        </button>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- Finished */

function FinishedView({ match }: { match: MatchDetail }) {
  const pens =
    match.pensHome != null && match.pensAway != null ? ` (${match.pensHome}:${match.pensAway} n.E.)` : "";
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 p-6 text-center">
      <p className="text-sm font-semibold uppercase tracking-wide text-[var(--color-pine)]">
        {PHASE_LABEL[match.phase]} · beendet
      </p>
      <div className="space-y-1">
        <p className="font-display text-2xl font-bold">{match.homeTeam?.name}</p>
        <p className="font-score text-7xl">
          {match.scoreHome} : {match.scoreAway}
        </p>
        <p className="font-display text-2xl font-bold">{match.awayTeam?.name}</p>
        {pens && <p className="text-[var(--color-ink)]/70">{pens.trim()}</p>}
      </div>
      {isKnockout(match.phase) && <p className="text-[var(--color-ink)]/60">Danke!</p>}
      <Link to="/ref" className="font-semibold text-[var(--color-pine)]">
        ← Zu meinen Spielen
      </Link>
    </div>
  );
}
