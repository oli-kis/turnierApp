import { Outlet, useNavigate } from "react-router-dom";
import { ProtectedRoute } from "../ProtectedRoute";
import { useAuth } from "../../auth/AuthContext";
import { useOutboxFlush } from "../../api/useOutbox";

export function RefereeLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  // Anywhere under /ref, not just on the match screen: a referee who taps
  // „Spiel beenden" offline and walks back to their match list must still have
  // that write land as soon as the signal returns.
  useOutboxFlush();

  return (
    <ProtectedRoute role="REFEREE">
      <div className="mx-auto min-h-dvh max-w-md">
        <header className="flex items-center justify-between border-b border-[var(--color-line)] px-4 py-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-pine)]">
              Schiedsrichter
            </p>
            <p className="font-semibold">{user?.name}</p>
          </div>
          <button
            onClick={() => {
              logout();
              navigate("/ref/login", { replace: true });
            }}
            className="text-sm font-semibold text-[var(--color-ink)]/60"
          >
            Abmelden
          </button>
        </header>
        <main>
          <Outlet />
        </main>
      </div>
    </ProtectedRoute>
  );
}
