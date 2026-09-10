import { describe, it, expect } from "vitest";
import { generateSchedule } from "@/lib/gameslate/schedule-generator";

// The division "Games per team" dropdown used to start at 6, so a short season
// could not be asked for at all. These cover the counts the dropdown now
// offers, so a low target cannot quietly be floored or ignored later.
const names = (n: number) => Array.from({ length: n }, (_, i) => "T" + (i + 1));
const gamesOf = (res: ReturnType<typeof generateSchedule>, id: string) =>
  res.games.filter((g) => g.away_team_id === id || g.home_team_id === id).length;

describe("short seasons", () => {
  const build = (target: number, teamCount = 6) =>
    generateSchedule({
      teams: names(teamCount).map((n) => ({ id: n, name: n })),
      startDate: "2026-04-11", weeks: 14, daysOfWeek: [6],
      fields: [{ name: "F", times: ["09:00", "11:00", "13:00"] }],
      targetGamesPerTeam: target,
    });

  it.each([4, 5, 6, 8, 10])("gives every team exactly %i games when asked for %i", (target) => {
    const res = build(target);
    for (const id of names(6)) expect(gamesOf(res, id)).toBe(target);
  });

  it("a five game season is not rounded up to six", () => {
    expect(gamesOf(build(5), "T1")).toBe(5);
  });

  it("an odd target works when the team count is even", () => {
    const res = build(5, 6);
    for (const id of names(6)) expect(gamesOf(res, id)).toBe(5);
  });

  // Every game contributes two team appearances, so teams x games must be
  // even. Five teams playing five each would need 25, which no schedule can
  // produce. The engine gets as close as parity allows rather than inventing
  // a game, and this records that so it is not mistaken for a bug later.
  it("gets as close as parity allows when the target is impossible", () => {
    const res = build(5, 5);
    const counts = names(5).map((id) => gamesOf(res, id));
    expect(counts.reduce((a, b) => a + b, 0) % 2).toBe(0);
    for (const c of counts) expect(Math.abs(c - 5)).toBeLessThanOrEqual(1);
  });

  it("a short target really is shorter than a long one", () => {
    expect(build(4).games.length).toBeLessThan(build(10).games.length);
  });
});
