import { useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useBracket, useMatches, useSlots, useStandings, useTournament } from "../../api/queries";
import { useTournamentEvents } from "../../api/sse";
import { ScoreCard } from "../../components/ScoreCard";
import { StandingsTable } from "../../components/StandingsTable";
import { BracketTree } from "../../components/BracketTree";
import { EmptyState } from "../../components/EmptyState";
import { formatSlotTime, delayLabel, formatTime } from "../../lib/time";
import { buildBeamerPages, type BeamerPage } from "../../lib/beamerPages";

/**
 * Big-screen mode for the beamer at the clubhouse: no navigation, no chrome, no
 * operator. The deck composes itself from live data and cycles forever.
 *
 * Read from across a room, so everything is scaled up with `zoom` on the stage
 * rather than by giving the shared components a fourth size — the ScoreCard's
 * three-size identity is the point of the design system, and a projector is a
 * controlled environment (one Chrome, one screen) where zoom is safe.
 *
 * `?interval=20` seconds per page, `?scale=1.8` to fit the room.
 */
export function BeamerView() {
  const { id } = useParams();
  const [params] = useSearchParams();
  useTournamentEvents(id);

  const { data: tournament } = useTournament(id);
  const { data: slots } = useSlots(id);
  const { data: matches } = useMatches(id);

  const pages = buildBeamerPages({ tournament, slots, matches });
  const interval = clampNumber(params.get("interval"), 15, 3, 300) * 1000;
  const scale = clampNumber(params.get("scale"), 1.5, 1, 4);

  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  // The deck reshapes itself as the day progresses (a bracket appears, a slot
  // finishes); never point past the end of it.
  const safeIndex = pages.length > 0 ? index % pages.length : 0;
  const page: BeamerPage | undefined = pages[safeIndex];

  const step = useCallback(
    (delta: number) => {
      setIndex((i) => (pages.length === 0 ? 0 : (i + delta + pages.length) % pages.length));
    },
    [pages.length],
  );

  useEffect(() => {
    if (paused || pages.length <= 1) return;
    const timer = setInterval(() => step(1), interval);
    return () => clearInterval(timer);
  }, [paused, pages.length, interval, step, safeIndex]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") step(1);
      else if (e.key === "ArrowLeft") step(-1);
      else if (e.key === " ") {
        e.preventDefault();
        setPaused((p) => !p);
      } else if (e.key.toLowerCase() === "f") {
        void toggleFullscreen();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step]);

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[var(--color-chalk)] text-[var(--color-ink)]">
      <BeamerHeader
        tournamentName={tournament?.name}
        title={page?.title}
        position={pages.length > 0 ? `${safeIndex + 1} / ${pages.length}` : ""}
        paused={paused}
      />

      <main className="flex-1 overflow-hidden px-8 py-6">
        {page ? (
          <div style={{ zoom: scale }} className="h-full">
            <PageBody page={page} matchDurationMin={tournament?.matchDurationMin ?? 12} />
          </div>
        ) : (
          <div className="flex h-full items-center justify-center">
            <EmptyState
              title="Noch nichts zu zeigen"
              hint="Sobald der Spielplan steht, läuft hier die Anzeige."
            />
          </div>
        )}
      </main>

      <DwellBar key={`${safeIndex}-${paused}`} duration={interval} paused={paused || pages.length <= 1} />
    </div>
  );
}

/* ------------------------------------------------------------------ chrome */

function BeamerHeader({
  tournamentName,
  title,
  position,
  paused,
}: {
  tournamentName?: string;
  title?: string;
  position: string;
  paused: boolean;
}) {
  return (
    <header className="flex shrink-0 items-baseline justify-between gap-6 border-b border-[var(--color-line)] px-8 py-4">
      <div className="flex items-baseline gap-4">
        <h1 className="font-display text-3xl font-extrabold uppercase tracking-wide">{title ?? ""}</h1>
        {paused && (
          <span className="text-sm font-semibold uppercase tracking-wide text-[var(--color-ink)]/60">
            pausiert
          </span>
        )}
      </div>
      <div className="flex items-baseline gap-6 text-lg font-semibold text-[var(--color-ink)]/70">
        <span className="truncate">{tournamentName ?? ""}</span>
        <span className="tabular-nums">{position}</span>
        <Clock />
      </div>
    </header>
  );
}

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 10_000);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="font-score text-2xl tabular-nums text-[var(--color-ink)]">
      {formatTime(now.toISOString())}
    </span>
  );
}

/**
 * Dwell progress for the current page. Pine, not `--color-live`: it is a UI
 * timer, not tournament time, and the live colour has to stay scarce enough that
 * a delay or a running clock still jumps off the wall.
 */
function DwellBar({ duration, paused }: { duration: number; paused: boolean }) {
  const [filled, setFilled] = useState(false);
  useEffect(() => {
    if (paused) return;
    // Next frame, so the transition animates from 0 rather than jumping.
    const id = requestAnimationFrame(() => setFilled(true));
    return () => cancelAnimationFrame(id);
  }, [paused]);

  return (
    <div className="h-1.5 w-full shrink-0 bg-[var(--color-line)]">
      <div
        // scaleX rather than width: this bar animates all day on the beamer
        // machine, and only transform stays off the layout path.
        className="h-full w-full origin-left bg-[var(--color-pine)] motion-reduce:transition-none"
        style={{
          transform: `scaleX(${paused || !filled ? 0 : 1})`,
          transition: paused ? "none" : `transform ${duration}ms linear`,
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------- pages */

function PageBody({ page, matchDurationMin }: { page: BeamerPage; matchDurationMin: number }) {
  switch (page.kind) {
    case "live":
      return <LivePage page={page} matchDurationMin={matchDurationMin} />;
    case "next":
      return <NextPage page={page} />;
    case "standings":
      return <StandingsPage page={page} />;
    case "bracket":
      return <BracketPage page={page} />;
  }
}

function LivePage({
  page,
  matchDurationMin,
}: {
  page: Extract<BeamerPage, { kind: "live" }>;
  matchDurationMin: number;
}) {
  return (
    <div className="grid grid-cols-2 gap-5">
      {page.matches.map((m) => (
        <ScoreCard
          key={m.id}
          size="lg"
          pitch={m.pitch?.name}
          homeTeam={m.homeTeam?.name}
          awayTeam={m.awayTeam?.name}
          scoreHome={m.scoreHome}
          scoreAway={m.scoreAway}
          status={m.status}
          actualStart={page.slot.actualStart}
          matchDurationMin={matchDurationMin}
          plannedStart={m.slot?.plannedStart}
          estimatedStart={m.estimatedStart}
          tournamentStatus="RUNNING"
        />
      ))}
    </div>
  );
}

function NextPage({ page }: { page: Extract<BeamerPage, { kind: "next" }> }) {
  const delay = delayLabel(page.slot.plannedStart, page.slot.estimatedStart);
  return (
    <div className="space-y-4">
      <div className="flex items-baseline gap-4">
        <span className="font-score text-4xl font-bold tabular-nums">
          {formatSlotTime(page.slot.plannedStart, page.slot.estimatedStart)}
        </span>
        {delay && <span className="text-2xl font-bold text-[var(--color-live)]">{delay}</span>}
      </div>
      <div className="divide-y divide-[var(--color-line)] overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-line)] bg-white">
        {page.matches.map((m) => (
          <div key={m.id} className="flex items-center gap-6 px-5 py-4">
            <span className="w-24 shrink-0 font-score text-2xl font-bold tabular-nums">
              {formatSlotTime(m.slot?.plannedStart, m.estimatedStart)}
            </span>
            <span className="min-w-0 flex-1 truncate text-xl font-semibold">
              {m.homeTeam?.name ?? "—"} <span className="text-[var(--color-ink)]/50">gegen</span>{" "}
              {m.awayTeam?.name ?? "—"}
            </span>
            {m.pitch && (
              <span className="shrink-0 text-lg font-semibold text-[var(--color-pine)]">
                {m.pitch.name}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function StandingsPage({ page }: { page: Extract<BeamerPage, { kind: "standings" }> }) {
  const { data, isLoading } = useStandings(page.groupId);

  if (isLoading) return null; // the deck moves on; a skeleton on a wall is noise
  if (!data || data.standings.length === 0) {
    return <EmptyState title="Noch keine Tabelle" hint="Sobald Spiele beendet sind." />;
  }
  return <StandingsTable rows={data.standings} qualifiersPerGroup={page.qualifiersPerGroup} />;
}

function BracketPage({ page }: { page: Extract<BeamerPage, { kind: "bracket" }> }) {
  const { data, isError } = useBracket(page.categoryId);

  if (isError || !data) return null;
  return <BracketTree bracket={data} />;
}

/* ------------------------------------------------------------------- utils */

function clampNumber(raw: string | null, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (!raw || Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

async function toggleFullscreen(): Promise<void> {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    // Fullscreen needs a user gesture and can be refused; the view works anyway.
  }
}
