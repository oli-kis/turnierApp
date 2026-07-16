import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMatches, useTournament } from "../../api/queries";
import { useTournamentEvents } from "../../api/sse";
import { MatchRow } from "../../components/MatchRow";
import { CardSkeleton } from "../../components/Skeleton";
import { EmptyState, ErrorState } from "../../components/EmptyState";
import { formatSlotTime } from "../../lib/time";
import { groupMatchesBySlot, isScoreEditable } from "../../lib/groupMatches";
import { ScoreCorrectionSheet } from "./ScoreCorrectionSheet";
import type { MatchListItem, MatchStatus } from "../../api/types";

type StatusFilter = "ALL" | "UPCOMING" | "RUNNING" | "FINISHED";

const STATUS_TABS: { value: StatusFilter; label: string }[] = [
  { value: "ALL", label: "Alle" },
  { value: "UPCOMING", label: "Geplant" },
  { value: "RUNNING", label: "Läuft" },
  { value: "FINISHED", label: "Beendet" },
];

function matchesStatus(status: MatchStatus, filter: StatusFilter): boolean {
  switch (filter) {
    case "ALL":
      return true;
    case "UPCOMING":
      return status === "SCHEDULED" || status === "READY";
    case "RUNNING":
      return status === "RUNNING";
    case "FINISHED":
      return status === "FINISHED";
  }
}

function nameMatches(m: MatchListItem, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return (
    (m.homeTeam?.name ?? "").toLowerCase().includes(needle) ||
    (m.awayTeam?.name ?? "").toLowerCase().includes(needle)
  );
}

/**
 * Admin all-matches overview: every match of the day — past, running, upcoming —
 * grouped by round, with inline result correction for finished/running matches.
 * SSE-live so a finishing match or corrected score updates in place.
 */
export function AdminMatches() {
  const { id } = useParams();
  useTournamentEvents(id);
  const { data: tournament } = useTournament(id);
  const { data: matches, isLoading, isError } = useMatches(id);

  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [categoryId, setCategoryId] = useState("");
  const [search, setSearch] = useState("");
  const [editTarget, setEditTarget] = useState<MatchListItem | null>(null);

  const categories = tournament?.categories ?? [];

  const groups = useMemo(() => {
    const filtered = (matches ?? []).filter(
      (m) =>
        matchesStatus(m.status, status) &&
        (!categoryId || m.categoryId === categoryId) &&
        nameMatches(m, search),
    );
    return groupMatchesBySlot(filtered);
  }, [matches, status, categoryId, search]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link to={`/admin/t/${id}/live`} className="text-sm font-semibold text-[var(--color-pine)]">
            ← Live-Dashboard
          </Link>
          <h1 className="mt-1 font-display text-2xl font-extrabold">Alle Spiele</h1>
        </div>
      </div>

      {/* Filters */}
      <div className="space-y-3">
        <div className="flex flex-wrap gap-1">
          {STATUS_TABS.map((t) => (
            <button
              key={t.value}
              onClick={() => setStatus(t.value)}
              aria-pressed={status === t.value}
              className={[
                "h-12 rounded-lg px-4 text-sm font-semibold transition-colors",
                status === t.value
                  ? "bg-[var(--color-pine)] text-white"
                  : "bg-white text-[var(--color-ink)] border border-[var(--color-line)] hover:border-[var(--color-pine)]",
              ].join(" ")}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {categories.length > 0 && (
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="h-12 rounded-lg border border-[var(--color-line)] bg-white px-3 text-sm font-semibold"
            >
              <option value="">Alle Kategorien</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Team suchen…"
            className="h-12 min-w-0 flex-1 rounded-lg border border-[var(--color-line)] px-3 text-sm sm:max-w-xs"
          />
        </div>
      </div>

      {isLoading ? (
        <CardSkeleton />
      ) : isError ? (
        <ErrorState message="Spiele konnten nicht geladen werden." />
      ) : groups.length === 0 ? (
        <EmptyState
          title="Keine Spiele"
          hint={
            (matches?.length ?? 0) === 0
              ? "Erstelle zuerst einen Spielplan im Setup."
              : "Keine Spiele passen zu diesen Filtern."
          }
        />
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <section key={g.key}>
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <h2 className="font-display text-sm font-bold uppercase tracking-wide text-[var(--color-ink)]/70">
                  {g.slotIndex === null ? "Ohne Runde" : `Runde ${g.slotIndex + 1}`}
                </h2>
                {g.slotIndex !== null && (
                  <span className="font-score text-sm font-bold tabular-nums text-[var(--color-ink)]">
                    {formatSlotTime(g.plannedStart, g.estimatedStart)}
                  </span>
                )}
              </div>
              <ul className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-line)] bg-white">
                {g.matches.map((m) => (
                  <li key={m.id} className="flex items-center border-b border-[var(--color-line)] last:border-b-0">
                    <div className="min-w-0 flex-1">
                      <MatchRow
                        homeTeam={m.homeTeam?.name}
                        awayTeam={m.awayTeam?.name}
                        scoreHome={m.scoreHome}
                        scoreAway={m.scoreAway}
                        status={m.status}
                        pitch={m.pitch?.name}
                        estimatedStart={m.estimatedStart}
                        plannedStart={m.slot?.plannedStart}
                        tournamentStatus={tournament?.status}
                      />
                    </div>
                    {isScoreEditable(m.status) && (
                      <button
                        onClick={() => setEditTarget(m)}
                        className="mr-2 flex h-12 shrink-0 items-center rounded-lg px-3 text-sm font-semibold text-[var(--color-pine)] hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-pine)]"
                      >
                        Ergebnis
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {editTarget && (
        <ScoreCorrectionSheet
          key={editTarget.id}
          open
          onClose={() => setEditTarget(null)}
          matchId={editTarget.id}
          tournamentId={id!}
          initialHome={editTarget.scoreHome}
          initialAway={editTarget.scoreAway}
          teams={{ home: editTarget.homeTeam?.name ?? "—", away: editTarget.awayTeam?.name ?? "—" }}
        />
      )}
    </div>
  );
}
