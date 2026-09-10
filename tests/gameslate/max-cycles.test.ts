// gameslate addition: exact round robin counts via opts.maxCycles.
// Kept out of schedule-generator.test.ts so that file stays a verbatim copy
// of league-platform's and future syncs are a clean diff.
import { describe, it, expect } from "vitest";
import { generateSchedule } from "@/lib/gameslate/schedule-generator";

const teams = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `T${i + 1}`, name: `T${i + 1}` }));

const base = {
  startDate: "2026-04-14",
  daysOfWeek: [2, 4],
  fields: [
    { name: "F1", times: ["17:30", "19:00"] },
    { name: "F2", times: ["17:30", "19:00"] },
  ],
  gamesPerWeek: 1,
  weeklyPairing: "different-opponents" as const,
};

const pairCounts = (games: { away_team_id: string; home_team_id: string }[]) => {
  const c: Record<string, number> = {};
  for (const g of games) {
    const k = [g.away_team_id, g.home_team_id].sort().join("|");
    c[k] = (c[k] ?? 0) + 1;
  }
  return c;
};

describe("maxCycles", () => {
  it("1 cycle: every pair meets exactly once, then the season ends", () => {
    const r = generateSchedule({ ...base, teams: teams(6), weeks: 30, maxCycles: 1 });
    expect(r.games.length).toBe(15);
    for (const n of Object.values(pairCounts(r.games))) expect(n).toBe(1);
    expect(r.everyPairPlayed).toBe(true);
  });

  it("2 cycles: every pair meets exactly twice", () => {
    const r = generateSchedule({ ...base, teams: teams(6), weeks: 30, maxCycles: 2 });
    expect(r.games.length).toBe(30);
    for (const n of Object.values(pairCounts(r.games))) expect(n).toBe(2);
  });

  it("works with odd team counts and byes", () => {
    const r = generateSchedule({ ...base, teams: teams(5), weeks: 30, maxCycles: 1 });
    expect(r.games.length).toBe(10);
    for (const n of Object.values(pairCounts(r.games))) expect(n).toBe(1);
  });

  it("respects two rounds per week without straddling into an extra cycle", () => {
    const r = generateSchedule({
      ...base,
      teams: teams(6),
      weeks: 30,
      gamesPerWeek: 2,
      maxCycles: 1,
    });
    expect(r.games.length).toBe(15);
    for (const n of Object.values(pairCounts(r.games))) expect(n).toBe(1);
  });

  it("unset keeps the old fill-the-calendar behaviour", () => {
    const r = generateSchedule({ ...base, teams: teams(6), weeks: 8 });
    expect(r.games.length).toBeGreaterThan(15);
  });

  it("too little calendar still just fits what it can and warns", () => {
    const r = generateSchedule({ ...base, teams: teams(6), weeks: 2, maxCycles: 1 });
    expect(r.games.length).toBeLessThan(15);
    expect(r.everyPairPlayed).toBe(false);
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});
