import type { ReactNode } from "react";

type Tone = "neutral" | "pine" | "live" | "win" | "loss";

const tones: Record<Tone, string> = {
  neutral: "bg-white text-[var(--color-ink)] border-[var(--color-line)]",
  pine: "bg-[var(--color-pine)] text-white border-[var(--color-pine)]",
  live: "bg-[var(--color-live)] text-white border-[var(--color-live)]",
  win: "bg-white text-[var(--color-win)] border-[var(--color-win)]",
  loss: "bg-white text-[var(--color-loss)] border-[var(--color-loss)]",
};

export function Tag({
  tone = "neutral",
  pulse = false,
  children,
}: {
  tone?: Tone;
  pulse?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      className={[
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide",
        tones[tone],
        pulse ? "animate-ready-pulse" : "",
      ].join(" ")}
    >
      {children}
    </span>
  );
}

/** The LIVE tag — the one reserved use of the live color as a surface. */
export function LiveTag() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-live)] px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide text-white">
      <span className="h-1.5 w-1.5 rounded-full bg-white animate-ready-pulse" />
      Live
    </span>
  );
}
