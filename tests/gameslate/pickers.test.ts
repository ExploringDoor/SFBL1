// gameslate additions: per-weekday field times and per-team allowed days.
import { describe, it, expect } from "vitest";
import { generateSchedule, weekdayOf } from "@/lib/gameslate/schedule-generator";

const teams = (n: number, extra: object = {}) =>
  Array.from({ length: n }, (_, i) => ({ id: `T${i + 1}`, name: `T${i + 1}`, ...extra }));

describe("timesByDay: different start times on the weekend", () => {
  const base = {
    startDate: "2026-04-14", // a Tuesday
    daysOfWeek: [2, 6],
    weeks: 6,
    gameMinutes: 90,
    fields: [{ name: "Main", times: ["17:30", "19:00"], timesByDay: { 6: ["09:00", "11:00", "13:00"] } }],
  };
  it("Saturday games use the Saturday list, weeknights use the everyday list", () => {
    const r = generateSchedule({ ...base, teams: teams(6) });
    expect(r.games.length).toBeGreaterThan(0);
    for (const g of r.games) {
      if (weekdayOf(g.date) === 6) expect(["09:00", "11:00", "13:00"]).toContain(g.time);
      else expect(["17:30", "19:00"]).toContain(g.time);
    }
    expect(r.games.some((g) => weekdayOf(g.date) === 6)).toBe(true);
    expect(r.games.some((g) => weekdayOf(g.date) === 2)).toBe(true);
  });
  it("a weekend-only field (no everyday times) is still a valid field", () => {
    const r = generateSchedule({
      ...base,
      daysOfWeek: [6],
      teams: teams(4),
      fields: [{ name: "SatOnly", times: [], timesByDay: { 6: ["09:00", "11:00"] } }],
    });
    expect(r.warnings).toEqual([]);
    expect(r.games.length).toBeGreaterThan(0);
    for (const g of r.games) expect(weekdayOf(g.date)).toBe(6);
  });
});

describe("allowedDays: a team that can only play on certain weekdays", () => {
  it("never schedules that team on a day it did not allow", () => {
    const r = generateSchedule({
      startDate: "2026-04-14",
      daysOfWeek: [2, 4, 6],
      weeks: 8,
      gameMinutes: 90,
      fields: [{ name: "F1", times: ["17:30", "19:00"] }, { name: "F2", times: ["17:30", "19:00"] }],
      teams: [...teams(1, { allowedDays: [6] }), ...teams(5).slice(1)],
    });
    const t1 = r.games.filter((g) => g.away_team_id === "T1" || g.home_team_id === "T1");
    expect(t1.length).toBeGreaterThan(0);
    for (const g of t1) expect(weekdayOf(g.date)).toBe(6);
  });
});
