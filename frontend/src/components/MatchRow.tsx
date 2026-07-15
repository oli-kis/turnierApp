import type { MatchStatus, TournamentStatus } from "../api/types";
import { formatTime } from "../lib/time";
import { resultOutcome } from "../lib/matchState";
import { LiveTag } from "./Tag";

/**
 * Compact schedule/list row: time · pitch on the left, teams + result on the
 * right. Used in group match lists and the team-day page. Tuned for 360px.
 *
 * The kickoff time is the single most important datum for players/parents, so it
 * leads every row in display weight — estimated, annotated with the plan when
 * they differ (improvements.md item 1).
 */
export function MatchRow({
  homeTeam,
  awayTeam,
  scoreHome,
  scoreAway,
  status,
  pitch,
  estimatedStart,
  plannedStart,
  tournamentStatus,
}: {
  homeTeam: string | null | undefined;
  awayTeam: string | null | undefined;
  scoreHome: number;
  scoreAway: number;
  status: MatchStatus;
  pitch?: string | null;
  estimatedStart?: string | null;
  plannedStart?: string | null;
  /** When set and not RUNNING, suppresses the LIVE badge (item 9 defence). */
  tournamentStatus?: TournamentStatus;
}) {
  const finished = status === "FINISHED";
  const running = status === "RUNNING" && (tournamentStatus === undefined || tournamentStatus === "RUNNING");
  const est = formatTime(estimatedStart ?? plannedStart);
  const plan = formatTime(plannedStart);
  const delayed = est !== "–" && plan !== "–" && est !== plan;
  const homeOut = finished ? resultOutcome(scoreHome, scoreAway) : null;
  const awayOut = finished ? resultOutcome(scoreAway, scoreHome) : null;

  return (
    <div className="flex items-center gap-3 border-b border-[var(--color-line)] px-3 py-2.5 last:border-b-0">
      <div className="flex w-16 shrink-0 flex-col items-start">
        <span className="font-score text-[15px] font-bold tabular-nums leading-tight text-[var(--color-ink)]">
          {est}
        </span>
        {delayed && (
          <span className="whitespace-nowrap text-[10px] font-medium tabular-nums text-[var(--color-ink)]/60">
            geplant {plan}
          </span>
        )}
        {pitch && <span className="truncate text-[11px] font-medium text-[var(--color-ink)]/70">{pitch}</span>}
      </div>

      <div className="min-w-0 flex-1">
        <TeamLine name={homeTeam} outcome={homeOut} />
        <TeamLine name={awayTeam} outcome={awayOut} />
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {running && <LiveTag />}
        {finished || running ? (
          <div className="flex flex-col items-end font-score tabular-nums text-lg leading-tight">
            <span>{scoreHome}</span>
            <span>{scoreAway}</span>
          </div>
        ) : (
          <span className="text-sm font-medium text-[var(--color-ink)]/55">–:–</span>
        )}
      </div>
    </div>
  );
}

function TeamLine({ name, outcome }: { name: string | null | undefined; outcome: "win" | "loss" | "draw" | null }) {
  const color =
    outcome === "win"
      ? "text-[var(--color-win)]"
      : outcome === "loss"
        ? "text-[var(--color-ink)]/60"
        : "text-[var(--color-ink)]";
  return (
    <div className={`truncate text-[15px] font-semibold ${outcome ? color : "text-[var(--color-ink)]"}`}>
      {name ?? "—"}
    </div>
  );
}
