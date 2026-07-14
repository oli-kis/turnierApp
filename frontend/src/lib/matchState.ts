import type { MatchPhase, MatchStatus, SlotStatus } from "../api/types";

/** German phase labels (de-CH UI copy). */
export const PHASE_LABEL: Record<MatchPhase, string> = {
  GROUP: "Gruppe",
  ROUND_OF_16: "Achtelfinale",
  QUARTERFINAL: "Viertelfinale",
  SEMIFINAL: "Halbfinale",
  THIRD_PLACE: "Spiel um Platz 3",
  FINAL: "Final",
};

export const MATCH_STATUS_LABEL: Record<MatchStatus, string> = {
  SCHEDULED: "Angesetzt",
  READY: "Bereit",
  RUNNING: "Läuft",
  FINISHED: "Beendet",
};

export const SLOT_STATUS_LABEL: Record<SlotStatus, string> = {
  PENDING: "Ausstehend",
  WAITING_READY: "Bereitmachen",
  RUNNING: "Läuft",
  FINISHED: "Beendet",
};

export function isLive(status: MatchStatus): boolean {
  return status === "RUNNING";
}

export function isKnockout(phase: MatchPhase): boolean {
  return phase !== "GROUP";
}

/** Result glyph for a finished match from one team's perspective. */
export function resultOutcome(
  scoreFor: number,
  scoreAgainst: number,
): "win" | "loss" | "draw" {
  if (scoreFor > scoreAgainst) return "win";
  if (scoreFor < scoreAgainst) return "loss";
  return "draw";
}
