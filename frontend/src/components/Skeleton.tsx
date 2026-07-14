/** Skeletons for tables/cards — never full-page spinners (spec). */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-[var(--color-line)] ${className}`} />;
}

export function CardSkeleton() {
  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-white p-4">
      <Skeleton className="mb-3 h-3 w-20" />
      <Skeleton className="h-8 w-full" />
    </div>
  );
}

export function TableSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-white p-3">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="mb-2 h-6 w-full last:mb-0" />
      ))}
    </div>
  );
}
