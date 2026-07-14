import { useEffect, type ReactNode } from "react";

/** Bottom sheet for confirmations (finish, penalties, corrections). */
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
      <button className="absolute inset-0 bg-black/40" aria-label="Schliessen" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-t-2xl border border-[var(--color-line)] bg-white p-5 sm:rounded-2xl">
        <h2 className="mb-4 font-display text-xl font-extrabold">{title}</h2>
        {children}
      </div>
    </div>
  );
}
