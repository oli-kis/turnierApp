import type { StandingRow } from "../api/types";

/**
 * The standings table is core content — designed first, tabular numerals, brutal
 * contrast for sunlight. Columns: Sp/S/U/N/Tore/TD/Pkt (de-CH abbreviations).
 * Rows at or above the qualification cut get a subtle pine left-border.
 */
export function StandingsTable({
  rows,
  qualifiersPerGroup,
}: {
  rows: StandingRow[];
  qualifiersPerGroup?: number | null;
}) {
  return (
    <div className="overflow-x-auto rounded-[var(--radius-card)] border border-[var(--color-line)] bg-white">
      <table className="w-full min-w-[22rem] border-collapse text-sm tnum">
        <thead>
          <tr className="border-b border-[var(--color-line)] text-left text-xs uppercase tracking-wide text-[var(--color-ink)]/70">
            <th className="py-2 pl-3 pr-2 font-semibold">#</th>
            <th className="py-2 pr-2 font-semibold">Team</th>
            <th className="py-2 px-2 text-right font-semibold" title="Spiele">Sp</th>
            <th className="py-2 px-2 text-right font-semibold" title="Siege">S</th>
            <th className="py-2 px-2 text-right font-semibold" title="Unentschieden">U</th>
            <th className="py-2 px-2 text-right font-semibold" title="Niederlagen">N</th>
            <th className="py-2 px-2 text-right font-semibold" title="Tore">Tore</th>
            <th className="py-2 px-2 text-right font-semibold" title="Tordifferenz">TD</th>
            <th className="py-2 pl-2 pr-3 text-right font-bold" title="Punkte">Pkt</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const qualifies = qualifiersPerGroup != null && r.rank <= qualifiersPerGroup;
            // Mark the qualification cut with a horizontal rule, not a side stripe.
            const isCutLine = qualifiersPerGroup != null && r.rank === qualifiersPerGroup;
            return (
              <tr
                key={r.teamId}
                className={[
                  isCutLine
                    ? "border-b-2 border-[var(--color-pine)]/40"
                    : "border-b border-[var(--color-line)] last:border-b-0",
                  qualifies ? "bg-[var(--color-pine)]/[0.05]" : "",
                ].join(" ")}
              >
                <td
                  className={`py-2.5 pl-3 pr-2 font-semibold ${qualifies ? "text-[var(--color-pine)]" : "text-[var(--color-ink)]/70"}`}
                >
                  {r.rank}
                </td>
                <td className="py-2.5 pr-2 font-semibold">{r.name}</td>
                <td className="py-2.5 px-2 text-right">{r.played}</td>
                <td className="py-2.5 px-2 text-right">{r.won}</td>
                <td className="py-2.5 px-2 text-right">{r.drawn}</td>
                <td className="py-2.5 px-2 text-right">{r.lost}</td>
                <td className="py-2.5 px-2 text-right">
                  {r.goalsFor}:{r.goalsAgainst}
                </td>
                <td className="py-2.5 px-2 text-right">
                  {r.goalDifference > 0 ? `+${r.goalDifference}` : r.goalDifference}
                </td>
                <td className="py-2.5 pl-2 pr-3 text-right font-bold">{r.points}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
