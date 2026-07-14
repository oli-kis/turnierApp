import type { ReactNode } from "react";

/** Every list needs a designed empty state that says what to do next (spec). */
export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--color-line)] bg-white px-4 py-8 text-center">
      <p className="font-semibold text-[var(--color-ink)]">{title}</p>
      {hint && <p className="mt-1 text-sm text-[var(--color-ink)]/70">{hint}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-loss)] bg-white px-4 py-6 text-center">
      <p className="font-semibold text-[var(--color-loss)]">{message}</p>
    </div>
  );
}
