import { Outlet, useNavigate } from "react-router-dom";
import { ProtectedRoute } from "../ProtectedRoute";
import { useAuth } from "../../auth/AuthContext";

export function RefereeLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

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
