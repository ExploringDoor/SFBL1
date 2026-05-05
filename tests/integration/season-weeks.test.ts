// Tests for lib/season-weeks.ts → computeWeeks + pickActiveWeek.
//
// This drives the WK 1 / WK 2 / ... selector on Schedule and Scores
// tabs. Subtle date math: Monday-start weeks, range labels that
// collapse same-month ("Apr 20–22") vs cross-month ("Apr 30–May 3"),
// active-week selection that falls back to the last week if all are
// in the past.
//
// Failure modes guarded against:
//   - Off-by-one weekday (Sunday should bucket with the PREVIOUS week's Monday)
//   - Time-zone drift (date math should be timezone-stable)
//   - Same-day vs same-month vs cross-month label divergence
//   - Active week resolution when "today" sits between weeks

import { describe, expect, it } from "vitest";
import { computeWeeks, pickActiveWeek } from "@/lib/season-weeks";

// ── computeWeeks: empty + single ─────────────────────────────────

describe("computeWeeks — empty / single", () => {
  it("returns empty array on empty input", () => {
    expect(computeWeeks([])).toEqual([]);
  });

  it("ignores games with empty date strings", () => {
    expect(computeWeeks([{ date: "" }])).toEqual([]);
  });

  it("single game produces one week with day-only label", () => {
    const weeks = computeWeeks([{ date: "2026-05-13" }]); // Wednesday
    expect(weeks).toHaveLength(1);
    expect(weeks[0]!.number).toBe(1);
    expect(weeks[0]!.dates).toEqual(["2026-05-13"]);
    expect(weeks[0]!.rangeLabel).toBe("May 13");
    expect(weeks[0]!.startIso).toBe("2026-05-11"); // Monday of that week
  });
});

// ── computeWeeks: weekday → Monday bucketing ─────────────────────

describe("computeWeeks — Monday-start bucketing", () => {
  it("Monday game keeps that Monday as its bucket start", () => {
    const weeks = computeWeeks([{ date: "2026-05-11" }]); // Mon
    expect(weeks[0]!.startIso).toBe("2026-05-11");
  });

  it("Tuesday game buckets under the previous Monday", () => {
    const weeks = computeWeeks([{ date: "2026-05-12" }]); // Tue
    expect(weeks[0]!.startIso).toBe("2026-05-11");
  });

  it("Sunday game buckets under the previous Monday (DVSL pattern)", () => {
    // Important — Sunday is the LAST day of the week here, not the first.
    // Sun May 17 should bucket with Mon May 11.
    const weeks = computeWeeks([{ date: "2026-05-17" }]);
    expect(weeks[0]!.startIso).toBe("2026-05-11");
  });

  it("strips trailing time/Z from a full ISO datetime", () => {
    const weeks = computeWeeks([{ date: "2026-05-13T18:00:00Z" }]);
    expect(weeks[0]!.dates).toEqual(["2026-05-13"]);
  });
});

// ── computeWeeks: range labels ──────────────────────────────────

describe("computeWeeks — range label format", () => {
  it("multi-day same-month: 'May 13–15'", () => {
    const weeks = computeWeeks([
      { date: "2026-05-13" },
      { date: "2026-05-14" },
      { date: "2026-05-15" },
    ]);
    expect(weeks).toHaveLength(1);
    expect(weeks[0]!.rangeLabel).toBe("May 13–15");
    expect(weeks[0]!.dates).toEqual([
      "2026-05-13",
      "2026-05-14",
      "2026-05-15",
    ]);
  });

  it("cross-month: 'Apr 30–May 3'", () => {
    // Both fall in the same Monday-week (Mon Apr 27).
    // Apr 30 = Thu, May 3 = Sun — both bucketed with Mon Apr 27.
    const weeks = computeWeeks([
      { date: "2026-04-30" },
      { date: "2026-05-03" },
    ]);
    expect(weeks).toHaveLength(1);
    expect(weeks[0]!.rangeLabel).toBe("Apr 30–May 3");
    expect(weeks[0]!.startIso).toBe("2026-04-27");
  });

  it("dedupes duplicate date strings", () => {
    const weeks = computeWeeks([
      { date: "2026-05-13" },
      { date: "2026-05-13" },
      { date: "2026-05-13" },
    ]);
    expect(weeks[0]!.dates).toEqual(["2026-05-13"]);
    expect(weeks[0]!.rangeLabel).toBe("May 13");
  });
});

// ── computeWeeks: multi-week ────────────────────────────────────

describe("computeWeeks — multi-week sequencing", () => {
  it("buckets games into separate weeks, numbered from 1", () => {
    const weeks = computeWeeks([
      { date: "2026-05-13" }, // wk 1 (Mon May 11)
      { date: "2026-05-20" }, // wk 2 (Mon May 18)
      { date: "2026-05-27" }, // wk 3 (Mon May 25)
    ]);
    expect(weeks).toHaveLength(3);
    expect(weeks.map((w) => w.number)).toEqual([1, 2, 3]);
    expect(weeks.map((w) => w.startIso)).toEqual([
      "2026-05-11",
      "2026-05-18",
      "2026-05-25",
    ]);
  });

  it("sorts weeks ascending regardless of input order", () => {
    const weeks = computeWeeks([
      { date: "2026-05-27" },
      { date: "2026-05-13" },
      { date: "2026-05-20" },
    ]);
    expect(weeks.map((w) => w.startIso)).toEqual([
      "2026-05-11",
      "2026-05-18",
      "2026-05-25",
    ]);
  });

  it("week numbering is 1-indexed from the EARLIEST week", () => {
    const weeks = computeWeeks([
      { date: "2026-08-01" }, // late
      { date: "2026-04-01" }, // early
    ]);
    // April should be wk 1, August wk 2.
    const april = weeks.find((w) => w.startIso < "2026-05-01")!;
    expect(april.number).toBe(1);
    const aug = weeks.find((w) => w.startIso > "2026-07-01")!;
    expect(aug.number).toBe(2);
  });
});

// ── pickActiveWeek ──────────────────────────────────────────────

describe("pickActiveWeek", () => {
  const buildWeeks = () =>
    computeWeeks([
      { date: "2026-05-13" }, // wk 1 — Mon May 11
      { date: "2026-05-20" }, // wk 2 — Mon May 18
      { date: "2026-05-27" }, // wk 3 — Mon May 25
    ]);

  it("returns null when no weeks", () => {
    expect(pickActiveWeek([])).toBeNull();
  });

  it("picks the EARLIEST week whose Monday is on/after today", () => {
    const weeks = buildWeeks();
    // Today = Tue May 12 → earliest Monday >= Mon May 11 is wk 1.
    expect(pickActiveWeek(weeks, new Date("2026-05-12T12:00:00Z"))).toBe(
      "2026-05-11",
    );
  });

  it("today inside a week (mid-week) keeps that same week active", () => {
    const weeks = buildWeeks();
    // Today = Sat May 16 → today's Monday IS May 11 → wk 1 still
    // active (we're inside its window). Better UX than jumping ahead.
    expect(pickActiveWeek(weeks, new Date("2026-05-16T12:00:00Z"))).toBe(
      "2026-05-11",
    );
  });

  it("today in a gap week (no games) jumps forward to next scheduled week", () => {
    // Weeks at May 11 + May 25 (skip May 18 — no games that week).
    // Today = Sat May 23 → today's Monday = May 18, no week there →
    // jumps to next scheduled = May 25.
    const weeks = computeWeeks([
      { date: "2026-05-13" }, // wk 1 — Mon May 11
      { date: "2026-05-27" }, // wk 2 — Mon May 25 (gap on May 18)
    ]);
    expect(pickActiveWeek(weeks, new Date("2026-05-23T12:00:00Z"))).toBe(
      "2026-05-25",
    );
  });

  it("when ALL weeks are past, falls back to the last week", () => {
    const weeks = buildWeeks();
    expect(pickActiveWeek(weeks, new Date("2026-12-01T00:00:00Z"))).toBe(
      "2026-05-25",
    );
  });

  it("today sitting on a week's Monday picks that week (boundary case)", () => {
    const weeks = buildWeeks();
    // Today = Mon May 18 → wk 2's Monday = today → picks wk 2.
    expect(pickActiveWeek(weeks, new Date("2026-05-18T12:00:00Z"))).toBe(
      "2026-05-18",
    );
  });

  it("all weeks in the future: picks the FIRST one", () => {
    const weeks = buildWeeks();
    expect(pickActiveWeek(weeks, new Date("2026-01-01T00:00:00Z"))).toBe(
      "2026-05-11",
    );
  });
});
