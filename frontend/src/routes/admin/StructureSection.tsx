import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as struct from "../../api/endpoints/structure";
import { ApiError } from "../../api/client";
import { useStandings, qk } from "../../api/queries";
import type { Category, Group, Team } from "../../api/types";
import { Button } from "../../components/Button";
import { Sheet } from "../../components/Sheet";
import { EditableText } from "./EditableText";

export function StructureSection({
  tournamentId,
  categories,
}: {
  tournamentId: string;
  categories: Category[];
}) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: qk.tournament(tournamentId) });
  const [newCat, setNewCat] = useState("");

  const addCategory = useMutation({
    mutationFn: () => struct.createCategory(tournamentId, { name: newCat }),
    onSuccess: () => {
      setNewCat("");
      invalidate();
    },
  });

  return (
    <div className="space-y-4">
      {categories.map((c) => (
        <CategoryEditor key={c.id} category={c} onChanged={invalidate} />
      ))}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (newCat.trim()) addCategory.mutate();
        }}
        className="flex gap-2"
      >
        <input
          value={newCat}
          onChange={(e) => setNewCat(e.target.value)}
          placeholder="Neue Kategorie (z. B. Junioren D)"
          className="flex-1 rounded-lg border border-[var(--color-line)] px-3 py-2"
        />
        <Button type="submit" disabled={!newCat.trim() || addCategory.isPending}>
          Hinzufügen
        </Button>
      </form>
    </div>
  );
}

function CategoryEditor({ category, onChanged }: { category: Category; onChanged: () => void }) {
  const qc = useQueryClient();
  const [qualError, setQualError] = useState<string | null>(null);
  const [koError, setKoError] = useState<string | null>(null);
  const [newGroup, setNewGroup] = useState("");
  const invalidate = () => {
    onChanged();
    qc.invalidateQueries({ queryKey: qk.bracket(category.id) });
  };

  const rename = useMutation({
    mutationFn: (name: string) => struct.updateCategory(category.id, { name }),
    onSuccess: onChanged,
  });
  const setQualifiers = useMutation({
    mutationFn: (q: number | null) => struct.updateCategory(category.id, { qualifiersPerGroup: q }),
    onSuccess: () => {
      setQualError(null);
      onChanged();
    },
    onError: (e) => setQualError(e instanceof ApiError ? e.message : "Fehler"),
  });
  const remove = useMutation({
    mutationFn: () => struct.deleteCategory(category.id),
    onSuccess: onChanged,
  });
  const addGroup = useMutation({
    mutationFn: () => struct.createGroup(category.id, newGroup),
    onSuccess: () => {
      setNewGroup("");
      onChanged();
    },
  });
  const knockout = useMutation({
    mutationFn: () => struct.generateKnockout(category.id),
    onSuccess: () => {
      setKoError(null);
      invalidate();
    },
    onError: (e) => setKoError(e instanceof ApiError ? e.message : "Fehler"),
  });

  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <EditableText
          value={category.name}
          onSave={(n) => rename.mutate(n)}
          className="font-display text-lg font-bold"
        />
        <button onClick={() => remove.mutate()} className="text-sm font-semibold text-[var(--color-loss)]">
          Kategorie löschen
        </button>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="text-sm font-semibold">Qualifikanten/Gruppe</label>
        <input
          type="number"
          min={1}
          defaultValue={category.qualifiersPerGroup ?? ""}
          onBlur={(e) => {
            const v = e.target.value === "" ? null : Number(e.target.value);
            setQualifiers.mutate(v);
          }}
          className="w-20 rounded-lg border border-[var(--color-line)] px-2 py-1"
        />
        {category.knockoutGenerated && <span className="text-sm text-[var(--color-ink)]/60">(gesperrt)</span>}
      </div>
      {qualError && <p className="mb-3 text-sm font-semibold text-[var(--color-loss)]">{qualError}</p>}

      <div className="space-y-3">
        {(category.groups ?? []).map((g) => (
          <GroupEditor key={g.id} group={g} onChanged={onChanged} />
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (newGroup.trim()) addGroup.mutate();
        }}
        className="mt-3 flex gap-2"
      >
        <input
          value={newGroup}
          onChange={(e) => setNewGroup(e.target.value)}
          placeholder="Neue Gruppe (z. B. Gruppe A)"
          className="flex-1 rounded-lg border border-[var(--color-line)] px-3 py-2"
        />
        <Button type="submit" variant="secondary" disabled={!newGroup.trim() || addGroup.isPending}>
          Gruppe +
        </Button>
      </form>

      {!category.knockoutGenerated && (
        <div className="mt-4 border-t border-[var(--color-line)] pt-3">
          <Button variant="secondary" onClick={() => knockout.mutate()} disabled={knockout.isPending}>
            K.-o.-Runde erstellen
          </Button>
          {koError && <p className="mt-2 text-sm font-semibold text-[var(--color-loss)]">{koError}</p>}
        </div>
      )}
    </div>
  );
}

function GroupEditor({ group, onChanged }: { group: Group; onChanged: () => void }) {
  const [newTeam, setNewTeam] = useState("");
  const rename = useMutation({
    mutationFn: (name: string) => struct.updateGroup(group.id, name),
    onSuccess: onChanged,
  });
  const remove = useMutation({ mutationFn: () => struct.deleteGroup(group.id), onSuccess: onChanged });
  const addTeam = useMutation({
    mutationFn: () => struct.createTeam(group.id, newTeam),
    onSuccess: () => {
      setNewTeam("");
      onChanged();
    },
  });

  return (
    <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-chalk)] p-3">
      <div className="mb-2 flex items-center justify-between">
        <EditableText value={group.name} onSave={(n) => rename.mutate(n)} className="font-semibold" />
        <button onClick={() => remove.mutate()} className="text-xs font-semibold text-[var(--color-loss)]">
          Gruppe löschen
        </button>
      </div>

      <ul className="mb-2 space-y-1">
        {(group.teams ?? []).map((t) => (
          <TeamRow key={t.id} team={t} onChanged={onChanged} />
        ))}
        {(group.teams ?? []).length === 0 && (
          <li className="text-sm text-[var(--color-ink)]/50">Noch keine Teams — füge das erste hinzu.</li>
        )}
      </ul>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (newTeam.trim()) addTeam.mutate();
        }}
        className="flex gap-2"
      >
        <input
          value={newTeam}
          onChange={(e) => setNewTeam(e.target.value)}
          placeholder="Team +"
          className="flex-1 rounded-lg border border-[var(--color-line)] bg-white px-3 py-1.5 text-sm"
        />
        <Button type="submit" variant="ghost" disabled={!newTeam.trim() || addTeam.isPending}>
          +
        </Button>
      </form>

      <GroupTiebreak groupId={group.id} teams={group.teams ?? []} onChanged={onChanged} />
    </div>
  );
}

function TeamRow({ team, onChanged }: { team: Team; onChanged: () => void }) {
  const rename = useMutation({
    mutationFn: (name: string) => struct.updateTeam(team.id, { name }),
    onSuccess: onChanged,
  });
  const remove = useMutation({ mutationFn: () => struct.deleteTeam(team.id), onSuccess: onChanged });
  return (
    <li className="flex items-center justify-between rounded bg-white px-3 py-1.5">
      <EditableText value={team.name} onSave={(n) => rename.mutate(n)} className="text-sm" />
      <button onClick={() => remove.mutate()} className="text-xs font-semibold text-[var(--color-loss)]">
        ✕
      </button>
    </li>
  );
}

/** Draw-of-lots resolver, only surfaced when standings report an unresolved tie. */
function GroupTiebreak({
  groupId,
  teams,
  onChanged,
}: {
  groupId: string;
  teams: Team[];
  onChanged: () => void;
}) {
  const { data } = useStandings(groupId);
  const [open, setOpen] = useState(false);
  const [order, setOrder] = useState<string[]>([]);
  const qc = useQueryClient();

  const save = useMutation({
    mutationFn: () => struct.setTiebreak(groupId, order),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.standings(groupId) });
      onChanged();
      setOpen(false);
    },
  });

  if (!data?.tieUnresolved) return null;

  const openSheet = () => {
    setOrder(data.standings.map((r) => r.teamId));
    setOpen(true);
  };
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j]!, next[i]!];
    setOrder(next);
  };
  const nameOf = (id: string) => teams.find((t) => t.id === id)?.name ?? data.standings.find((r) => r.teamId === id)?.name ?? id;

  return (
    <>
      <button onClick={openSheet} className="mt-2 text-sm font-semibold text-[var(--color-live)]">
        Punktgleichheit — Reihenfolge per Los festlegen
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Reihenfolge per Los">
        <ol className="mb-4 space-y-2">
          {order.map((id, i) => (
            <li key={id} className="flex items-center justify-between rounded-lg border border-[var(--color-line)] px-3 py-2">
              <span className="font-semibold">
                {i + 1}. {nameOf(id)}
              </span>
              <span className="flex gap-1">
                <button onClick={() => move(i, -1)} className="h-9 w-9 rounded border border-[var(--color-line)]">↑</button>
                <button onClick={() => move(i, 1)} className="h-9 w-9 rounded border border-[var(--color-line)]">↓</button>
              </span>
            </li>
          ))}
        </ol>
        <Button size="lg" className="w-full" onClick={() => save.mutate()} disabled={save.isPending}>
          Reihenfolge speichern
        </Button>
      </Sheet>
    </>
  );
}
