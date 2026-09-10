// gameslate additions: sub-pools inside a division and umpire capacity.
import { describe, it, expect } from "vitest";
import { generateSchedule } from "@/lib/gameslate/schedule-generator";

const teams = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `T${i + 1}`, name: `T${i + 1}` }));
const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

describe("sub-pools", () => {
  it("in-pool pairs meet twice, cross-pool pairs once, then the season ends", () => {
    const pools = { T1: "A", T2: "A", T3: "A", T4: "A", T5: "B", T6: "B", T7: "B", T8: "B" };
    const r = generateSchedule({
      startDate: "2026-04-14",
      daysOfWeek: [2, 4, 6],
      weeks: 30,
      gameMinutes: 90,
      fields: [{ name: "F1", times: ["17:30", "19:00"] }, { name: "F2", times: ["17:30", "19:00"] }, { name: "F3", times: ["17:30", "19:00"] }],
      teams: teams(8),
      pools,
      poolCycles: 2,
      crossPoolCycles: 1,
    });
    const meets = new Map<string, number>();
    for (const g of r.games) {
      const k = [g.away_team_id, g.home_team_id].sort().join("|");
      meets.set(k, (meets.get(k) ?? 0) + 1);
    }
    for (const [k, n] of meets) {
      const [a, b] = k.split("|") as [string, string];
      expect(n).toBe(pools[a as keyof typeof pools] === pools[b as keyof typeof pools] ? 2 : 1);
    }
    expect(meets.size).toBe(28);
  });
});

describe("maxSimultaneousGames (umpire capacity)", () => {
  it("never starts more overlapping games than there are umpires, even with spare fields", () => {
    const r = generateSchedule({
      startDate: "2026-04-14",
      daysOfWeek: [2],
      weeks: 8,
      gameMinutes: 90,
      fields: [{ name: "F1", times: ["17:30", "19:00"] }, { name: "F2", times: ["17:30", "19:00"] }, { name: "F3", times: ["17:30", "19:00"] }],
      teams: teams(6),
      maxSimultaneousGames: 2,
    });
    expect(r.games.length).toBeGreaterThan(0);
    const byDate: Record<string, number[]> = {};
    for (const g of r.games) (byDate[g.date] ??= []).push(mins(g.time));
    for (const starts of Object.values(byDate)) {
      for (const s of starts) {
        const overlapping = starts.filter((t) => s < t + 90 && t < s + 90).length;
        expect(overlapping).toBeLessThanOrEqual(2);
      }
    }
  });
});
