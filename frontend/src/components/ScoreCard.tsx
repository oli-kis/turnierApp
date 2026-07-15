import { useEffect, useState } from "react";
import type { MatchStatus, TournamentStatus } from "../api/types";
import { secondsSince, formatSlotTime } from "../lib/time";
import { LiveTag } from "./Tag";

export type ScoreCardSize = "sm" | "md" | "lg";

interface ScoreCardProps {
  pitch?: string | null;
  homeTeam: string | null | undefined;
  awayTeam: string | null | undefined;
  scoreHome: number;
  scoreAway: number;
  status: MatchStatus;
  actualStart?: string | null;
  matchDurationMin?: number;
  size?: ScoreCardSize;
  /** Kickoff times; shown as the eyebrow when the match is not running (item 1). */
  plannedStart?: string | null;
  estimatedStart?: string | null;
  /** When set and not RUNNING, suppresses the LIVE badge/clock (item 9 defence). */
  tournamentStatus?: TournamentStatus;
  /** Extra note under the card (phase, etc.), used when no kickoff time applies. */
  eyebrowRight?: string | null;
}

const sizeClasses: Record<ScoreCardSize, { team: string; score: string; pad: string; gap: string }> = {
  sm: { team: "text-base", score: "text-3xl", pad: "p-3", gap: "gap-2" },
  md: { team: "text-lg sm:text-xl", score: "text-4xl sm:text-5xl", pad: "p-4", gap: "gap-3" },
  lg: { team: "text-2xl sm:text-3xl", score: "text-7xl sm:text-8xl", pad: "p-5", gap: "gap-4" },
};

/**
 * The signature "live score card", reused verbatim at three sizes across the
 * public „Jetzt läuft", the admin dashboard, and the referee screen — one shared
 * scoreboard identity. A thin live-colored bar fills across matchDurationMin.
 */
export function ScoreCard({
  pitch,
  homeTeam,
  awayTeam,
  scoreHome,
  scoreAway,
  status,
  actualStart,
  matchDurationMin,
  size = "md",
  plannedStart,
  estimatedStart,
  tournamentStatus,
  eyebrowRight,
}: ScoreCardProps) {
  const s = sizeClasses[size];
  const running =
    status === "RUNNING" && (tournamentStatus === undefined || tournamentStatus === "RUNNING");
  const progress = useMatchProgress(running ? actualStart : null, matchDurationMin);
  const kickoff =
    plannedStart || estimatedStart ? formatSlotTime(plannedStart, estimatedStart) : null;

  return (
    <div className={`overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-line)] bg-white ${s.pad}`}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-pine)]">
          {pitch ?? "—"}
        </span>
        {running ? (
          <LiveTag />
        ) : kickoff ? (
          <span className="whitespace-nowrap text-sm font-bold tabular-nums text-[var(--color-ink)]">
            {kickoff}
          </span>
        ) : eyebrowRight ? (
          <span className="text-xs font-medium text-[var(--color-ink)]/70 tnum">{eyebrowRight}</span>
        ) : null}
      </div>

      <div className={`flex items-center justify-between ${s.gap}`}>
        <span className={`min-w-0 flex-1 truncate font-semibold ${s.team}`}>{homeTeam ?? "—"}</span>
        <span className="flex items-center gap-1 font-score">
          <span key={`h-${scoreHome}`} className={`${s.score} animate-score-tick`}>{scoreHome}</span>
          <span className={`${s.score} text-[var(--color-line)]`}>:</span>
          <span key={`a-${scoreAway}`} className={`${s.score} animate-score-tick`}>{scoreAway}</span>
        </span>
        <span className={`min-w-0 flex-1 truncate text-right font-semibold ${s.team}`}>{awayTeam ?? "—"}</span>
      </div>

      {/* Progress rail — only meaningful while running. */}
      <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-[var(--color-line)]">
        <div
          className="h-full rounded-full bg-[var(--color-live)] transition-[width] duration-1000 ease-linear"
          style={{ width: running ? `${progress}%` : "0%" }}
        />
      </div>
    </div>
  );
}

function useMatchProgress(actualStart: string | null | undefined, matchDurationMin?: number): number {
  const [pct, setPct] = useState(0);
  useEffect(() => {
    if (!actualStart || !matchDurationMin) {
      setPct(0);
      return;
    }
    const compute = () => {
      const elapsed = secondsSince(actualStart);
      setPct(Math.min(100, (elapsed / (matchDurationMin * 60)) * 100));
    };
    compute();
    const id = setInterval(compute, 1000);
    return () => clearInterval(id);
  }, [actualStart, matchDurationMin]);
  return pct;
}
