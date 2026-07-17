import { Link } from "react-router-dom";
import { useMyMatches } from "../../api/queries";
import { PHASE_LABEL, MATCH_STATUS_LABEL } from "../../lib/matchState";
import { formatTime } from "../../lib/time";
import { Tag, LiveTag } from "../../components/Tag";
import { CardSkeleton } from "../../components/Skeleton";
import { EmptyState } from "../../components/EmptyState";
import { InstallPrompt } from "../../components/InstallPrompt";
import { NotificationPrompt } from "../../components/NotificationPrompt";
import type { RefereeMatch } from "../../api/types";

/** My matches, grouped by slot, the next actionable one pinned on top. */
export function RefereeHome() {
  const { data, isLoading } = useMyMatches();

  if (isLoading) {
    return (
      <div className="space-y-3 p-4">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="space-y-4 p-4">
        <EmptyState title="Noch keine Spiele zugeteilt" hint="Die Turnierleitung teilt dir Spiele zu." />
        {/* Best moment to install and opt in: before the first whistle, not
            during it — and with no matches yet, "you'll be told when you're
            assigned" is exactly the answer to the empty state. */}
        <InstallPrompt />
        <NotificationPrompt />
      </div>
    );
  }

  // Actionable = its slot is waiting-ready or running, and not finished.
  const actionable = data
    .filter((m) => m.status !== "FINISHED" && (m.slotStatus === "WAITING_READY" || m.slotStatus === "RUNNING"))
    .sort((a, b) => (a.slotIndex ?? 0) - (b.slotIndex ?? 0));
  const rest = data.filter((m) => !actionable.includes(m));

  const groups = new Map<number, RefereeMatch[]>();
  for (const m of rest) {
    const key = m.slotIndex ?? -1;
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }
  const slotKeys = [...groups.keys()].sort((a, b) => a - b);

  return (
    <div className="space-y-6 p-4">
      {actionable.length > 0 && (
        <section>
          <h2 className="mb-2 font-display text-sm font-bold uppercase tracking-wide text-[var(--color-live)]">
            Jetzt dran
          </h2>
          <div className="space-y-3">
            {actionable.map((m) => (
              <MatchCard key={m.id} match={m} highlight />
            ))}
          </div>
        </section>
      )}

      {slotKeys.map((key) => (
        <section key={key}>
          <h2 className="mb-2 font-display text-sm font-bold uppercase tracking-wide text-[var(--color-ink)]/60">
            {key < 0 ? "Ohne Runde" : `Runde ${key + 1}`}
          </h2>
          <div className="space-y-3">
            {groups.get(key)!.map((m) => (
              <MatchCard key={m.id} match={m} />
            ))}
          </div>
        </section>
      ))}

      <div className="space-y-3">
        <InstallPrompt />
        <NotificationPrompt />
      </div>
    </div>
  );
}

function MatchCard({ match, highlight = false }: { match: RefereeMatch; highlight?: boolean }) {
  const live = match.status === "RUNNING";
  return (
    <Link
      to={`/ref/spiel/${match.id}`}
      className={[
        "block rounded-[var(--radius-card)] border bg-white p-4",
        highlight ? "border-[var(--color-live)]" : "border-[var(--color-line)]",
      ].join(" ")}
    >
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-pine)]">
          {match.pitch ?? "—"} · {PHASE_LABEL[match.phase]}
        </span>
        {live ? <LiveTag /> : <Tag>{MATCH_STATUS_LABEL[match.status]}</Tag>}
      </div>
      <div className="font-display text-lg font-bold leading-tight">
        {match.homeTeam ?? "—"}
        <span className="px-2 text-[var(--color-line)]">vs</span>
        {match.awayTeam ?? "—"}
      </div>
      <div className="mt-1 text-sm text-[var(--color-ink)]/70 tabular-nums">
        Start {formatTime(match.estimatedStart)}
      </div>
    </Link>
  );
}
