import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { BracketTree } from "./BracketTree";
import type { Bracket, BracketMatch } from "../api/types";

function bm(partial: Partial<BracketMatch> & { id: string; phase: BracketMatch["phase"]; home: string; away: string }): BracketMatch {
  return {
    status: "SCHEDULED",
    scoreHome: 0,
    scoreAway: 0,
    ...partial,
  };
}

describe("BracketTree", () => {
  it("renders resolved teams and unresolved source labels", () => {
    const bracket: Bracket = {
      categoryId: "c1",
      generated: true,
      rounds: [
        {
          phase: "SEMIFINAL",
          matches: [
            bm({ id: "sf1", phase: "SEMIFINAL", home: "Alpha", away: "Bravo", status: "FINISHED", scoreHome: 2, scoreAway: 1 }),
            bm({ id: "sf2", phase: "SEMIFINAL", home: "1. Gruppe A", away: "2. Gruppe B" }),
          ],
        },
        {
          phase: "FINAL",
          matches: [bm({ id: "f", phase: "FINAL", home: "Sieger SF1", away: "Sieger SF2" })],
        },
        {
          phase: "THIRD_PLACE",
          matches: [bm({ id: "tp", phase: "THIRD_PLACE", home: "Verlierer SF1", away: "Verlierer SF2" })],
        },
      ],
    };

    render(<BracketTree bracket={bracket} />);

    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Sieger SF1")).toBeInTheDocument();
    expect(screen.getByText("Verlierer SF2")).toBeInTheDocument();
    expect(screen.getByText("1. Gruppe A")).toBeInTheDocument();
  });

  it("pulls the third-place match out of the main tree columns", () => {
    const bracket: Bracket = {
      categoryId: "c1",
      generated: true,
      rounds: [
        { phase: "FINAL", matches: [bm({ id: "f", phase: "FINAL", home: "A", away: "B" })] },
        { phase: "THIRD_PLACE", matches: [bm({ id: "tp", phase: "THIRD_PLACE", home: "C", away: "D" })] },
      ],
    };
    render(<BracketTree bracket={bracket} />);
    expect(screen.getByText("Spiel um Platz 3")).toBeInTheDocument();
  });

  it("bolds the winner of a finished match", () => {
    const bracket: Bracket = {
      categoryId: "c1",
      generated: true,
      rounds: [
        {
          phase: "FINAL",
          matches: [bm({ id: "f", phase: "FINAL", home: "Winner", away: "Loser", status: "FINISHED", scoreHome: 3, scoreAway: 0 })],
        },
      ],
    };
    render(<BracketTree bracket={bracket} />);
    expect(screen.getByText("Winner").className).toContain("font-bold");
  });
});
