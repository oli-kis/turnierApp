import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useTeamSearch } from "../../api/queries";
import { EmptyState } from "../../components/EmptyState";
import { Skeleton } from "../../components/Skeleton";

/** Search-as-you-type (debounced 300ms) → team day page. */
export function TeamsSearch() {
  const { id } = useParams();
  const [input, setInput] = useState("");
  const q = useDebounced(input, 300);
  const { data, isFetching } = useTeamSearch(id, q);

  return (
    <div className="space-y-4">
      <h2 className="font-display text-2xl font-extrabold">Teams</h2>

      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Team suchen…"
        autoFocus
        className="w-full rounded-[var(--radius-card)] border border-[var(--color-line)] bg-white px-4 py-3 text-base outline-none focus:border-[var(--color-pine)]"
      />

      {isFetching && !data ? (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : data && data.length > 0 ? (
        <ul className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-line)] bg-white">
          {data.map((t) => (
            <li key={t.id}>
              <Link
                to={`/team/${t.id}`}
                className="flex items-center justify-between gap-3 border-b border-[var(--color-line)] px-4 py-3 last:border-b-0 hover:bg-black/5"
              >
                <span className="font-semibold">{t.name}</span>
                <span className="text-sm text-[var(--color-ink)]/60">
                  {t.category}
                  {t.group ? ` · ${t.group}` : ""}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : input ? (
        <EmptyState title="Kein Team gefunden" hint="Andere Schreibweise versuchen." />
      ) : (
        <EmptyState title="Tippe einen Team-Namen" hint="Die Suche startet ab dem ersten Buchstaben." />
      )}
    </div>
  );
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}
