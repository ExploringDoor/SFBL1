// gameslate additions: seeded layout variety + schedule quality scoring.
// Kept out of schedule-generator.test.ts so that file stays a verbatim copy
// of league-platform's.
import { describe, it, expect } from "vitest";
import { generateSchedule, scheduleQuality } from "@/lib/gameslate/schedule-generator";

const teams = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `T${i + 1}`, name: `T${i + 1}` }));

const base = {
  startDate: "2026-04-14",
  daysOfWeek: [2, 4],
  weeks: 12,
  fields: [
    { name: "F1", times: ["17:30", "19:00"] },
    { name: "F2", times: ["17:30", "19:00"] },
  ],
};

const key = (g: { away_team_id: string; home_team_id: string }) =>
  [g.away_team_id, g.home_team_id].sort().join("|");

describe("seeded layout variety", () => {
  it("same seed reproduces the same schedule", () => {
    const a = generateSchedule({ ...base, teams: teams(6), seed: 7 });
    const b = generateSchedule({ ...base, teams: teams(6), seed: 7 });
    expect(JSON.stringify(a.games)).toBe(JSON.stringify(b.games));
  });

  it("no seed keeps the current deterministic output", () => {
    const a = generateSchedule({ ...base, teams: teams(6) });
    const b = generateSchedule({ ...base, teams: teams(6) });
    expect(JSON.stringify(a.games)).toBe(JSON.stringify(b.games));
  });

  it("different seeds produce different layouts", () => {
    const a = generateSchedule({ ...base, teams: teams(8), seed: 1 });
    const b = generateSchedule({ ...base, teams: teams(8), seed: 2 });
    expect(JSON.stringify(a.games)).not.toBe(JSON.stringify(b.games));
  });

  it("every seed still covers every pairing exactly once", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const r = generateSchedule({ ...base, teams: teams(6), seed, maxCycles: 1 });
      const counts: Record<string, number> = {};
      for (const g of r.games) counts[key(g)] = (counts[key(g)] ?? 0) + 1;
      expect(Object.keys(counts).length).toBe(15);
      for (const n of Object.values(counts)) expect(n).toBe(1);
    }
  });
});

describe("scheduleQuality", () => {
  it("scores a balanced schedule higher than a lopsided one", () => {
    const good = generateSchedule({ ...base, teams: teams(6), maxCycles: 1 });
    const gq = scheduleQuality(good.games);
    expect(gq.score).toBeGreaterThan(60);
    expect(["A", "B", "C", "D", "F"]).toContain(gq.grade);
  });

  it("penalizes unscheduled games", () => {
    const r = generateSchedule({ ...base, teams: teams(6), maxCycles: 1 });
    const clean = scheduleQuality(r.games, 0);
    const dinged = scheduleQuality(r.games, 3);
    expect(dinged.score).toBeLessThan(clean.score);
  });

  it("is deterministic", () => {
    const r = generateSchedule({ ...base, teams: teams(6), seed: 3 });
    expect(scheduleQuality(r.games)).toEqual(scheduleQuality(r.games));
  });

  it("reports perfect home/away balance as spread 0 when achievable", () => {
    // A single round robin of an even field balances home/away well.
    const r = generateSchedule({ ...base, teams: teams(4), maxCycles: 1 });
    const q = scheduleQuality(r.games);
    expect(q.homeAwaySpread).toBeLessThanOrEqual(2);
  });
});
