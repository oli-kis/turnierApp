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

export function OfflineBanner({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <div className="sticky top-0 z-40 bg-[var(--color-live)] px-4 py-2 text-center text-sm font-semibold text-white">
      Keine Verbindung — Aktionen werden erst gesendet, wenn du wieder online bist.
    </div>
  );
}
