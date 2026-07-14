import { useState } from "react";
import { useParams } from "react-router-dom";
import { useBracket, useTournament } from "../../api/queries";
import { BracketTree } from "../../components/BracketTree";
import { EmptyState } from "../../components/EmptyState";
import { TableSkeleton } from "../../components/Skeleton";

/** Bracket view per category (route `/t/:id/tabelle`). */
export function BracketPage() {
  const { id } = useParams();
  const { data: tournament } = useTournament(id);
  const categories = tournament?.categories ?? [];
  const [active, setActive] = useState<string | null>(null);
  const activeId = active ?? categories[0]?.id;

  return (
    <div className="space-y-5">
      <h2 className="font-display text-2xl font-extrabold">Tableau</h2>

      {categories.length === 0 ? (
        <EmptyState title="Noch keine Kategorien" />
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {categories.map((c) => (
              <button
                key={c.id}
                onClick={() => setActive(c.id)}
                className={[
                  "rounded-full px-3 py-2 text-sm font-semibold",
                  c.id === activeId
                    ? "bg-[var(--color-pine)] text-white"
                    : "border border-[var(--color-line)] bg-white text-[var(--color-ink)]",
                ].join(" ")}
              >
                {c.name}
              </button>
            ))}
          </div>
          {activeId && <CategoryBracket categoryId={activeId} />}
        </>
      )}
    </div>
  );
}

function CategoryBracket({ categoryId }: { categoryId: string }) {
  const { data, isLoading } = useBracket(categoryId);
  if (isLoading) return <TableSkeleton rows={5} />;
  if (!data || !data.generated || data.rounds.length === 0) {
    return <EmptyState title="Noch keine K.-o.-Runde" hint="Sobald die Gruppenphase entschieden ist." />;
  }
  return <BracketTree bracket={data} />;
}
