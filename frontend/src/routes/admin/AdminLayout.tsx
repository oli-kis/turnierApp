import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { ProtectedRoute } from "../ProtectedRoute";
import { useAuth } from "../../auth/AuthContext";
import { useReferees } from "../../api/queries";

function PendingBadge() {
  // Polls so a new registration surfaces even without a tournament SSE mounted.
  const { data } = useReferees("PENDING");
  const count = data?.length ?? 0;
  if (count === 0) return null;
  return (
    <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--color-live)] px-1.5 text-xs font-bold text-white">
      {count}
    </span>
  );
}

const link = "px-3 py-2 text-sm font-semibold rounded-lg whitespace-nowrap";

export function AdminLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <ProtectedRoute role="ADMIN">
      <div className="mx-auto min-h-dvh max-w-5xl">
        <header className="flex items-center justify-between gap-3 border-b border-[var(--color-line)] px-4 py-3">
          <nav className="flex items-center gap-1">
            <NavLink to="/admin" end className={({ isActive }) => tab(isActive)}>
              Turniere
            </NavLink>
            <NavLink to="/admin/referees" className={({ isActive }) => tab(isActive)}>
              Schiedsrichter
              <PendingBadge />
            </NavLink>
          </nav>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-[var(--color-ink)]/60 sm:inline">{user?.name}</span>
            <button
              onClick={() => {
                logout();
                navigate("/login", { replace: true });
              }}
              className="text-sm font-semibold text-[var(--color-ink)]/60"
            >
              Abmelden
            </button>
          </div>
        </header>
        <main className="p-4">
          <Outlet />
        </main>
      </div>
    </ProtectedRoute>
  );
}

function tab(active: boolean): string {
  return active
    ? `${link} bg-[var(--color-pine)] text-white`
    : `${link} text-[var(--color-ink)] hover:bg-black/5`;
}
