import type { Bracket, BracketMatch } from "../api/types";
import { PHASE_LABEL } from "../lib/matchState";

/**
 * Classic knockout tree: one column per round, matches vertically centered to
 * imply the bracket, horizontal-scroll on narrow screens. Unresolved slots show
 * their source label („Sieger Gruppe A", „Verlierer HF 1"). Third-place match is
 * pulled out beneath the final.
 */
export function BracketTree({ bracket }: { bracket: Bracket }) {
  const treeRounds = bracket.rounds.filter((r) => r.phase !== "THIRD_PLACE");
  const thirdPlace = bracket.rounds.find((r) => r.phase === "THIRD_PLACE");

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto pb-2">
        <div className="flex min-w-max gap-4">
          {treeRounds.map((round) => (
            <div key={round.phase} className="flex min-w-[15rem] flex-col justify-around gap-3">
              <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-ink)]/70">
                {PHASE_LABEL[round.phase]}
              </h3>
              {round.matches.map((m) => (
                <BracketMatchCard key={m.id} match={m} />
              ))}
            </div>
          ))}
        </div>
      </div>

      {thirdPlace && thirdPlace.matches.length > 0 && (
        <div className="max-w-sm">
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-[var(--color-ink)]/70">
            {PHASE_LABEL.THIRD_PLACE}
          </h3>
          <BracketMatchCard match={thirdPlace.matches[0]!} />
        </div>
      )}
    </div>
  );
}

function BracketMatchCard({ match }: { match: BracketMatch }) {
  const finished = match.status === "FINISHED";
  const homeWon = finished && match.scoreHome > match.scoreAway;
  const awayWon = finished && match.scoreAway > match.scoreHome;
  const pens =
    match.pensHome != null && match.pensAway != null ? ` (${match.pensHome}:${match.pensAway} n.E.)` : "";

  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-white">
      <BracketSide name={match.home} score={finished ? match.scoreHome : null} won={homeWon} />
      <div className="border-t border-[var(--color-line)]" />
      <BracketSide name={match.away} score={finished ? match.scoreAway : null} won={awayWon} />
      {(match.status === "RUNNING" || pens) && (
        <div className="border-t border-[var(--color-line)] px-3 py-1 text-[11px] font-medium text-[var(--color-ink)]/60">
          {match.status === "RUNNING" ? "läuft" : ""}
          {pens}
        </div>
      )}
    </div>
  );
}

function BracketSide({
  name,
  score,
  won,
}: {
  name: string;
  score: number | null;
  won: boolean;
}) {
  const resolved = score !== null || !/^(Sieger|Verlierer|\d+\.)/.test(name);
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2">
      <span
        className={[
          "min-w-0 flex-1 truncate text-sm",
          won ? "font-bold" : "font-medium",
          resolved ? "text-[var(--color-ink)]" : "text-[var(--color-ink)]/55 italic",
        ].join(" ")}
      >
        {name}
      </span>
      {score !== null && (
        <span className={`font-score tabular-nums text-base ${won ? "" : "text-[var(--color-ink)]/70"}`}>
          {score}
        </span>
      )}
    </div>
  );
}
