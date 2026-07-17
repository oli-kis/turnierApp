/**
 * de-CH time formatting, 24-hour, no AM/PM. All backend timestamps are UTC ISO
 * strings; the tournament runs in Europe/Zurich, applied here at the edge.
 */
const TZ = "Europe/Zurich";

const hm = new Intl.DateTimeFormat("de-CH", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: TZ,
});

const dmy = new Intl.DateTimeFormat("de-CH", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: TZ,
});

/** „14:30" */
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "–";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "–";
  return hm.format(d);
}

/**
 * „16.05.2026" — for dates away from tournament day (registration deadline,
 * tournament date), where a bare time would be meaningless.
 */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "–";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "–";
  return dmy.format(d);
}

/** „16.05.2026, 23:59" — a deadline needs both halves to be actionable. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "–";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "–";
  return `${dmy.format(d)}, ${hm.format(d)}`;
}

/**
 * Show the estimated start, annotating the plan when they differ:
 * „14:42 (geplant 14:30)". When equal (or no estimate), just the time.
 */
export function formatSlotTime(
  planned: string | null | undefined,
  estimated: string | null | undefined,
): string {
  if (!estimated) return formatTime(planned);
  const est = formatTime(estimated);
  const plan = formatTime(planned);
  return est === plan ? est : `${est} (geplant ${plan})`;
}

/** Delay in whole minutes between estimate and plan (>0 = late). */
export function delayMinutes(
  planned: string | null | undefined,
  estimated: string | null | undefined,
): number {
  if (!planned || !estimated) return 0;
  const p = new Date(planned).getTime();
  const e = new Date(estimated).getTime();
  if (Number.isNaN(p) || Number.isNaN(e)) return 0;
  return Math.round((e - p) / 60_000);
}

/** „+12 min verspätet" / „−3 min früher" / „" when on time. */
export function delayLabel(
  planned: string | null | undefined,
  estimated: string | null | undefined,
): string {
  const d = delayMinutes(planned, estimated);
  if (d === 0) return "";
  return d > 0 ? `+${d} min verspätet` : `${d} min früher`;
}

/** Elapsed whole seconds since an ISO instant (never negative). */
export function secondsSince(iso: string | null | undefined, now = Date.now()): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((now - t) / 1000));
}

/** „12:34" clock from a second count. */
export function formatClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
