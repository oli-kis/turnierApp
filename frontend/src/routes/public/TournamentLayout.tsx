import { NavLink, Outlet, useParams } from "react-router-dom";
import { useTournamentEvents } from "../../api/sse";
import { useTournament } from "../../api/queries";
import { Skeleton } from "../../components/Skeleton";

const navItem =
  "px-3 py-2 text-sm font-semibold rounded-full whitespace-nowrap transition-colors";

/** Layout for every tournament-scoped public route; owns the one EventSource. */
export function TournamentLayout() {
  const { id } = useParams();
  useTournamentEvents(id);
  const { data: tournament, isLoading } = useTournament(id);

  return (
    <div className="mx-auto min-h-dvh max-w-2xl">
      <header className="sticky top-0 z-30 border-b border-[var(--color-line)] bg-[var(--color-chalk)]/95 backdrop-blur">
        <div className="px-4 pb-2 pt-3">
          <NavLink to="/" className="text-xs font-semibold uppercase tracking-wide text-[var(--color-pine)]">
            FC Frick Turnier
          </NavLink>
          <h1 className="font-display text-xl font-extrabold leading-tight">
            {isLoading ? <Skeleton className="h-6 w-40" /> : tournament?.name ?? "Turnier"}
          </h1>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-2">
          <NavLink to={`/t/${id}`} end className={({ isActive }) => tab(isActive)}>
            Übersicht
          </NavLink>
          <NavLink to={`/t/${id}/tabelle`} className={({ isActive }) => tab(isActive)}>
            Tableau
          </NavLink>
          <NavLink to={`/t/${id}/teams`} className={({ isActive }) => tab(isActive)}>
            Teams
          </NavLink>
        </nav>
      </header>

      <main className="p-4">
        <Outlet />
      </main>
    </div>
  );
}

function tab(active: boolean): string {
  return active
    ? `${navItem} bg-[var(--color-pine)] text-white`
    : `${navItem} text-[var(--color-ink)] hover:bg-black/5`;
}
