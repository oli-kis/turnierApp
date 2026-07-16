import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { correctResult } from "../../api/endpoints/matches";
import { qk } from "../../api/queries";
import { useToast } from "../../components/Toast";
import { Button } from "../../components/Button";
import { Sheet } from "../../components/Sheet";

const CONFIRM_WORD = "KORRIGIEREN";

/**
 * Post-hoc result correction, guarded by a typed confirmation — correcting a
 * finished match rewrites a recorded result, so a plain OK is not enough.
 * Shared by the match editor and the admin all-matches overview.
 *
 * `key`ed by the current score at the call site so reopening on a different
 * match seeds the steppers fresh.
 */
export function ScoreCorrectionSheet({
  open,
  onClose,
  matchId,
  tournamentId,
  initialHome,
  initialAway,
  teams,
}: {
  open: boolean;
  onClose: () => void;
  matchId: string;
  tournamentId: string;
  initialHome: number;
  initialAway: number;
  /** Optional team names shown above the steppers for context in a list. */
  teams?: { home: string; away: string };
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [home, setHome] = useState(initialHome);
  const [away, setAway] = useState(initialAway);
  const [confirm, setConfirm] = useState("");

  const correct = useMutation({
    mutationFn: () => correctResult(matchId, { scoreHome: home, scoreAway: away }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.match(matchId) });
      qc.invalidateQueries({ queryKey: ["standings"] });
      qc.invalidateQueries({ queryKey: qk.dashboard(tournamentId) });
      qc.invalidateQueries({ queryKey: qk.matchLists(tournamentId) });
      toast.show("Resultat korrigiert", "success");
      setConfirm("");
      onClose();
    },
  });

  return (
    <Sheet open={open} onClose={onClose} title="Resultat korrigieren">
      {teams && (
        <p className="mb-2 text-center font-semibold">
          {teams.home} vs {teams.away}
        </p>
      )}
      <p className="mb-3 text-sm text-[var(--color-ink)]/70">
        Nachträgliche Korrektur wird protokolliert. Tippe <b>{CONFIRM_WORD}</b> zum Bestätigen.
      </p>
      <div className="mb-3 flex items-center justify-center gap-3">
        <input
          type="number"
          value={home}
          min={0}
          onChange={(e) => setHome(Math.max(0, Number(e.target.value)))}
          className="w-20 rounded-lg border border-[var(--color-line)] px-3 py-2 text-center font-score text-2xl"
        />
        <span className="font-score text-2xl">:</span>
        <input
          type="number"
          value={away}
          min={0}
          onChange={(e) => setAway(Math.max(0, Number(e.target.value)))}
          className="w-20 rounded-lg border border-[var(--color-line)] px-3 py-2 text-center font-score text-2xl"
        />
      </div>
      <input
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        placeholder={CONFIRM_WORD}
        className="mb-3 w-full rounded-lg border border-[var(--color-line)] px-3 py-2"
      />
      <Button
        variant="danger"
        size="lg"
        className="w-full"
        disabled={confirm !== CONFIRM_WORD || correct.isPending}
        onClick={() => correct.mutate()}
      >
        Korrektur speichern
      </Button>
    </Sheet>
  );
}
