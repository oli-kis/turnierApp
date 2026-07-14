import { describe, it, expect } from "vitest";
import { plannedStart, computeEstimatedStarts } from "../../src/domain/time.js";

const start = new Date("2026-07-14T08:00:00.000Z");

describe("plannedStart", () => {
  it("slot 0 is startAt", () => {
    expect(plannedStart(start, 0, 12, 3).toISOString()).toBe(start.toISOString());
  });

  it("advances by (duration + transition) per index", () => {
    // 12 + 3 = 15 min per slot
    expect(plannedStart(start, 1, 12, 3).toISOString()).toBe(
      new Date("2026-07-14T08:15:00.000Z").toISOString(),
    );
    expect(plannedStart(start, 4, 12, 3).toISOString()).toBe(
      new Date("2026-07-14T09:00:00.000Z").toISOString(),
    );
  });
});

describe("computeEstimatedStarts", () => {
  it("returns planned starts when nothing has started", () => {
    const slots = [0, 1, 2].map((index) => ({
      index,
      plannedStart: plannedStart(start, index, 12, 3),
      actualStart: null,
    }));
    const est = computeEstimatedStarts(slots, 12, 3);
    expect(est.get(0)!.toISOString()).toBe("2026-07-14T08:00:00.000Z");
    expect(est.get(1)!.toISOString()).toBe("2026-07-14T08:15:00.000Z");
    expect(est.get(2)!.toISOString()).toBe("2026-07-14T08:30:00.000Z");
  });

  it("cascades a late actual start to later slots", () => {
    const slots = [
      { index: 0, plannedStart: plannedStart(start, 0, 12, 3), actualStart: new Date("2026-07-14T08:10:00.000Z") },
      { index: 1, plannedStart: plannedStart(start, 1, 12, 3), actualStart: null },
      { index: 2, plannedStart: plannedStart(start, 2, 12, 3), actualStart: null },
    ];
    const est = computeEstimatedStarts(slots, 12, 3);
    // slot 0 started 10 min late; slot 1 = 08:10 + 15 = 08:25 (> planned 08:15)
    expect(est.get(1)!.toISOString()).toBe("2026-07-14T08:25:00.000Z");
    expect(est.get(2)!.toISOString()).toBe("2026-07-14T08:40:00.000Z");
  });

  it("never estimates earlier than the plan when running ahead", () => {
    const slots = [
      { index: 0, plannedStart: plannedStart(start, 0, 12, 3), actualStart: new Date("2026-07-14T07:55:00.000Z") },
      { index: 1, plannedStart: plannedStart(start, 1, 12, 3), actualStart: null },
    ];
    const est = computeEstimatedStarts(slots, 12, 3);
    // early start would give 07:55+15=08:10, but plan 08:15 wins
    expect(est.get(1)!.toISOString()).toBe("2026-07-14T08:15:00.000Z");
  });
});
