import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { listMatches } from "../../api/endpoints/matches";
import { ApiError } from "../../api/client";
import { useMatch, useTournament, qk } from "../../api/queries";
import { newClientId, sendOrQueue } from "../../api/outbox";
import { useOutboxFlush, useOutboxState, usePendingGoals } from "../../api/useOutbox";
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
  const { data: match, isLoading } = useMatch(id);
  useTournamentEvents(match?.tournamentId);
  useOutboxFlush(id);
  const online = useOnline();
  const { pending, flushing } = useOutboxState();

  return (
    <div className="flex min-h-[calc(100dvh-57px)] flex-col">
      <OfflineBanner show={!online || pending > 0} pending={pending} flushing={flushing} />
      <div className="border-b border-[var(--color-line)] px-4 py-2">
        <Link to="/ref" className="text-sm font-semibold text-[var(--color-pine)]">
          ← Meine Spiele
        </Link>
      </div>

      {isLoading ? (
        <div className="p-4">
          <CardSkeleton />
        </div>
      ) : !match || !id ? (
        // Only when there is nothing to show. A failed *refetch* must not take
        // the scoring screen away mid-match — the referee still has the match in
        // cache and possibly goals queued; the offline banner already says so.
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

/* ------------------------------------------------- optimistic cache helpers */

/**
 * Every referee write must reach `sendOrQueue`, offline included.
 *
 * TanStack Query's default `networkMode: "online"` *pauses* a mutation while the
 * browser reports offline: `onMutate` runs, `mutationFn` does not, and the write
 * waits in memory for a reconnect. That silently bypasses the outbox and, worse,
 * dies with the tab — a goal tapped in a dead spot would be gone if the referee
 * closed the app before signal returned. "always" hands the write to the outbox,
 * which persists it and owns the retry. Do not remove.
 */
const OUTBOX_MUTATION = { networkMode: "always" } as const;

interface Rollback {
  prev?: MatchDetail;
}

/**
 * The referee sees the result of a tap even when it only reached the outbox —
 * the queue guarantees it lands, so the UI must not pretend nothing happened.
 */
function setStatusOptimistically(
  qc: QueryClient,
  matchId: string,
  status: MatchDetail["status"],
): Rollback {
  const prev = qc.getQueryData<MatchDetail>(qk.match(matchId));
  qc.setQueryData<MatchDetail>(qk.match(matchId), (old) => (old ? { ...old, status } : old));
  return { prev };
}

function rollback(qc: QueryClient, matchId: string, ctx: Rollback | undefined): void {
  if (ctx?.prev) qc.setQueryData(qk.match(matchId), ctx.prev);
}

/* ---------------------------------------------------------------- Waiting */

function WaitingPhase({ match, matchId }: { match: MatchDetail; matchId: string }) {
  const qc = useQueryClient();
  const slotWaiting = match.slot?.status === "WAITING_READY";
  const isReady = match.status === "READY";

  // Ready/unready go through the outbox: the referee taps „bereit" exactly when
  // 22 phones are fighting for the same cell, and the tap must not be lost.
  const readyMut = useMutation({
    ...OUTBOX_MUTATION,
    mutationFn: () => sendOrQueue({ kind: "match.ready", matchId }),
    onMutate: () => setStatusOptimistically(qc, matchId, "READY"),
    onError: (_e, _v, ctx) => rollback(qc, matchId, ctx),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.match(matchId) }),
  });
  const unreadyMut = useMutation({
    ...OUTBOX_MUTATION,
    mutationFn: () => sendOrQueue({ kind: "match.unready", matchId }),
    onMutate: () => setStatusOptimistically(qc, matchId, "SCHEDULED"),
    onError: (_e, _v, ctx) => rollback(qc, matchId, ctx),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.match(matchId) }),
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
  const pendingGoals = usePendingGoals(matchId);

  const addGoal = useMutation({
    ...OUTBOX_MUTATION,
    mutationFn: ({ teamId, clientId }: { teamId: string; clientId: string }) =>
      sendOrQueue({ kind: "goal.add", matchId, teamId, clientId }),
    onMutate: async ({ teamId }) => {
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
    onError: (err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk.match(matchId), ctx.prev);
      toast.show(err instanceof ApiError ? err.message : "Tor konnte nicht gespeichert werden", "error");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.match(matchId) }),
  });

  /**
   * Undo works the same for a goal the server has and for one still queued: the
   * queued case never reaches the network — the outbox cancels the pending
   * `goal.add` instead, since the server has never heard of that id.
   */
  const deleteGoal = useMutation({
    ...OUTBOX_MUTATION,
    mutationFn: ({ id }: { id: string; teamId: string }) =>
      sendOrQueue({ kind: "goal.delete", goalId: id }),
    onMutate: async ({ id, teamId }) => {
      await qc.cancelQueries({ queryKey: qk.match(matchId) });
      const prev = qc.getQueryData<MatchDetail>(qk.match(matchId));
      qc.setQueryData<MatchDetail>(qk.match(matchId), (old) => {
        if (!old) return old;
        const home = teamId === old.homeTeamId;
        return {
          ...old,
          scoreHome: home ? Math.max(0, old.scoreHome - 1) : old.scoreHome,
          scoreAway: home ? old.scoreAway : Math.max(0, old.scoreAway - 1),
          goals: old.goals?.filter((g) => g.id !== id),
        };
      });
      return { prev };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk.match(matchId), ctx.prev);
      toast.show(err instanceof ApiError ? err.message : "Tor konnte nicht gelöscht werden", "error");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.match(matchId) }),
  });

  const finish = useMutation({
    ...OUTBOX_MUTATION,
    mutationFn: () => sendOrQueue({ kind: "match.finish", matchId }),
    onSuccess: (sent) => {
      setConfirmFinish(false);
      if (!sent) {
        toast.show("Offline — Spiel wird beendet, sobald du wieder Empfang hast", "info");
      }
      qc.invalidateQueries({ queryKey: qk.match(matchId) });
    },
    onError: (err) => {
      setConfirmFinish(false);
      // Defence in depth: the client decides this itself below, so reaching here
      // means the two disagreed (a goal landed from elsewhere between render and
      // tap). The server is the authority — open the sheet.
      if (err instanceof ApiError && err.code === "PENALTIES_REQUIRED") {
        setPenaltyOpen(true);
      }
    },
  });

  /**
   * Whether this match needs penalties is decided here rather than by asking the
   * server and waiting for `409 PENALTIES_REQUIRED`.
   *
   * That 409 needs a connection. Offline there is nothing to answer it: the
   * finish would be queued, replayed on reconnect, rejected with exactly that
   * 409, and — per the outbox's HTTP-error rule — dropped with a toast. The
   * referee would be left with an unfinished knockout match and no result. The
   * client knows the same two facts the server checks (knockout, drawn), so it
   * asks for the result up front and queues *that* instead.
   */
  const needsPenalties = isKnockout(match.phase) && match.scoreHome === match.scoreAway;

  const requestFinish = () => {
    setConfirmFinish(false);
    if (needsPenalties) {
      setPenaltyOpen(true);
      return;
    }
    finish.mutate();
  };

  const tap = (side: "home" | "away", teamId: string | null | undefined) => {
    if (!teamId || disabledSide) return;
    setDisabledSide(side);
    setTimeout(() => setDisabledSide(null), 400); // guard against double-taps
    addGoal.mutate({ teamId, clientId: newClientId() });
  };

  // Newest first: acknowledged goals from the server, queued ones on top —
  // both undoable, so a goal is never stuck just because the phone lost signal.
  const undoList = [
    ...pendingGoals.map((g) => ({ id: g.id, teamId: g.teamId, pending: true })),
    ...[...(match.goals ?? [])].reverse().map((g) => ({ id: g.id, teamId: g.teamId, pending: false })),
  ];

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
        {undoList.length > 0 && (
          <div className="mb-3 max-h-28 space-y-1 overflow-y-auto">
            {undoList.map((g) => {
              const home = g.teamId === match.homeTeamId;
              return (
                <div
                  key={g.id}
                  className="flex items-center justify-between rounded border border-[var(--color-line)] px-3 py-1.5 text-sm"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-semibold">
                      Tor {home ? match.homeTeam?.name : match.awayTeam?.name}
                    </span>
                    {g.pending && (
                      <span className="shrink-0 font-semibold text-[var(--color-live)]">
                        wird gesendet
                      </span>
                    )}
                  </span>
                  <button
                    onClick={() => deleteGoal.mutate({ id: g.id, teamId: g.teamId })}
                    className="shrink-0 font-semibold text-[var(--color-loss)]"
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
        {needsPenalties && (
          <p className="mb-4 font-semibold text-[var(--color-ink)]">
            Unentschieden — als Nächstes das Penaltyresultat.
          </p>
        )}
        <div className="flex gap-3">
          <Button variant="secondary" size="lg" className="flex-1" onClick={() => setConfirmFinish(false)}>
            Abbrechen
          </Button>
          <Button
            variant="danger"
            size="lg"
            className="flex-1"
            onClick={requestFinish}
            disabled={finish.isPending}
          >
            {needsPenalties ? "Weiter" : "Beenden"}
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
  const toast = useToast();
  const [home, setHome] = useState(0);
  const [away, setAway] = useState(0);

  /**
   * Through the outbox like every other referee write. A penalty result is the
   * one that decides who goes through, and it is tapped in the loudest, worst-
   * connected minute of the day — losing it to a dead spot is not survivable.
   *
   * The server dedupes an identical resubmission, so a replay of a request whose
   * response was lost reports success instead of MATCH_NOT_RUNNING.
   */
  const submit = useMutation({
    ...OUTBOX_MUTATION,
    mutationFn: () => sendOrQueue({ kind: "match.penalties", matchId, home, away }),
    onSuccess: (sent) => {
      if (!sent) {
        toast.show("Offline — Resultat wird gesendet, sobald du wieder Empfang hast", "info");
      }
      onClose();
      // Claimed only once the outbox has taken responsibility, never in onMutate:
      // the queue guarantees it lands, so showing the finished match is honest —
      // but flipping the status unmounts this sheet, so it has to come last.
      qc.setQueryData<MatchDetail>(qk.match(matchId), (old) =>
        old ? { ...old, status: "FINISHED", pensHome: home, pensAway: away } : old,
      );
      qc.invalidateQueries({ queryKey: qk.match(matchId) });
    },
    onError: (err) => {
      toast.show(
        err instanceof ApiError ? err.message : "Penaltyresultat konnte nicht gespeichert werden",
        "error",
      );
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
