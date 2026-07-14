import { Link } from "react-router-dom";

/** Shown after registration and on `403 REFEREE_PENDING` at login. */
export function RefereePending() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center p-5 text-center">
      <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full border-2 border-[var(--color-pine)]">
        <span className="h-3 w-3 rounded-full bg-[var(--color-pine)] animate-ready-pulse" />
      </div>
      <h1 className="font-display text-2xl font-extrabold">Warte auf Freigabe durch die Turnierleitung</h1>
      <p className="mt-3 text-[var(--color-ink)]/70">
        Sobald dein Konto freigegeben ist, kannst du dich anmelden und deine Spiele sehen.
      </p>
      <Link to="/ref/login" className="mt-6 font-semibold text-[var(--color-pine)]">
        Zur Anmeldung
      </Link>
    </div>
  );
}
