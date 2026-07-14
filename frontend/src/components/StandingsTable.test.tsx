import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { StandingsTable } from "./StandingsTable";
import type { StandingRow } from "../api/types";

function row(partial: Partial<StandingRow> & { teamId: string; name: string; rank: number }): StandingRow {
  return {
    played: 0,
    won: 0,
    drawn: 0,
    lost: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    goalDifference: 0,
    points: 0,
    ...partial,
  };
}

describe("StandingsTable", () => {
  const rows: StandingRow[] = [
    row({ teamId: "a", name: "Alpha", rank: 1, played: 2, won: 2, goalsFor: 5, goalsAgainst: 1, goalDifference: 4, points: 6 }),
    row({ teamId: "b", name: "Bravo", rank: 2, played: 2, won: 1, lost: 1, goalsFor: 3, goalsAgainst: 3, goalDifference: 0, points: 3 }),
    row({ teamId: "c", name: "Charlie", rank: 3, played: 2, lost: 2, goalsFor: 0, goalsAgainst: 4, goalDifference: -4, points: 0 }),
  ];

  it("renders every team with its points", () => {
    render(<StandingsTable rows={rows} />);
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Bravo")).toBeInTheDocument();
    expect(screen.getByText("Charlie")).toBeInTheDocument();
    // points column shows 6 / 3 / 0
    expect(screen.getByText("6")).toBeInTheDocument();
  });

  it("formats a positive goal difference with a plus sign", () => {
    render(<StandingsTable rows={rows} />);
    expect(screen.getByText("+4")).toBeInTheDocument();
    expect(screen.getByText("-4")).toBeInTheDocument();
  });

  it("tints qualifying rows and rules the qualification cut", () => {
    const { container } = render(<StandingsTable rows={rows} qualifiersPerGroup={2} />);
    const bodyRows = [...container.querySelectorAll("tbody tr")];
    const qualifying = bodyRows.filter((r) => r.className.includes("bg-[var(--color-pine)]/[0.05]"));
    expect(qualifying.length).toBe(2);
    // The 2nd (last qualifying) row carries the cut-line rule.
    const cutLine = bodyRows.filter((r) => r.className.includes("border-[var(--color-pine)]/40"));
    expect(cutLine.length).toBe(1);
  });
});
