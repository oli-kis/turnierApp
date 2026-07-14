import { useEffect, useState } from "react";
import { secondsSince, formatClock } from "../lib/time";

/**
 * Client-side count-up from `slot.actualStart`, ticking each second. Turns
 * `--color-live` once past `matchDurationMin` (regulation time elapsed).
 */
export function LiveClock({
  actualStart,
  matchDurationMin,
  className = "",
}: {
  actualStart: string | null | undefined;
  matchDurationMin: number;
  className?: string;
}) {
  const [seconds, setSeconds] = useState(() => secondsSince(actualStart));

  useEffect(() => {
    if (!actualStart) return;
    setSeconds(secondsSince(actualStart));
    const id = setInterval(() => setSeconds(secondsSince(actualStart)), 1000);
    return () => clearInterval(id);
  }, [actualStart]);

  const overtime = seconds >= matchDurationMin * 60;

  return (
    <span
      className={`font-score tabular-nums ${overtime ? "text-[var(--color-live)]" : "text-[var(--color-ink)]"} ${className}`}
      aria-label="Spielzeit"
    >
      {formatClock(seconds)}
    </span>
  );
}
