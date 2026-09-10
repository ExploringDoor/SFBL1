// gameslate addition: strict home/away alternation.
import { describe, it, expect } from "vitest";
import { generateSchedule, type GeneratedGame } from "@/lib/gameslate/schedule-generator";
const teams = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `T${i + 1}`, name: `T${i + 1}` }));
describe("homeAwayPattern: alternate", () => {
  it("rarely lets a team host twice in a row on neutral fields", () => {
    const r = generateSchedule({
      startDate: "2026-04-14", daysOfWeek: [2], weeks: 12, gameMinutes: 90,
      fields: [{ name: "F1", times: ["17:30", "19:00"] }, { name: "F2", times: ["17:30", "19:00"] }],
      teams: teams(6), homeAwayPattern: "alternate",
    });
    let repeats = 0, transitions = 0;
    for (const t of teams(6)) {
      const g = r.games.filter((x) => x.away_team_id === t.id || x.home_team_id === t.id).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
      for (let i = 1; i < g.length; i++) {
        transitions++;
        if ((g[i]!.home_team_id === t.id) === (g[i - 1]!.home_team_id === t.id)) repeats++;
      }
    }
    expect(repeats / Math.max(1, transitions)).toBeLessThan(0.35);
  });
});
