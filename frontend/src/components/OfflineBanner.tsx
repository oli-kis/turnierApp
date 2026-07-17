import { useEffect, useState } from "react";

/**
 * Sticky offline banner for the referee screen — `navigator.onLine` false means
 * a goal might not have reached the server; never silently drop it (spec).
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

interface OfflineBannerProps {
  show: boolean;
  /** Referee writes queued in the outbox, waiting for a connection. */
  pending?: number;
  flushing?: boolean;
}

/**
 * Says what happened to the taps, not just that the connection is gone: the
 * referee needs to know their goals are held and will land, and the banner stays
 * up while the queue drains after the signal returns.
 */
export function OfflineBanner({ show, pending = 0, flushing = false }: OfflineBannerProps) {
  if (!show) return null;

  const message = flushing
    ? `Wird gesendet … (${pending})`
    : pending > 0
      ? `Offline — ${pending} ${pending === 1 ? "Aktion wartet" : "Aktionen warten"} auf Verbindung`
      : "Keine Verbindung — Aktionen werden erst gesendet, wenn du wieder online bist.";

  return (
    <div
      role="status"
      aria-live="polite"
      className="sticky top-0 z-40 bg-[var(--color-live)] px-4 py-2 text-center text-sm font-semibold text-white tabular-nums"
    >
      {message}
    </div>
  );
}
