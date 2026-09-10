// gameslate additions: season shape rules a real league asks for.
import { describe, it, expect } from "vitest";
import { generateSchedule, weekdayOf, type GeneratedGame } from "@/lib/gameslate/schedule-generator";

const teams = (n: number, extra: object = {}) =>
  Array.from({ length: n }, (_, i) => ({ id: `T${i + 1}`, name: `T${i + 1}`, ...extra }));
const gamesOf = (g: GeneratedGame[], id: string) => g.filter((x) => x.away_team_id === id || x.home_team_id === id);
const byTime = (g: GeneratedGame[]) => [...g].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

const wide = {
  startDate: "2026-04-14",
  daysOfWeek: [2, 4, 6],
  weeks: 20,
  gameMinutes: 90,
  fields: [
    { name: "F1", times: ["17:30", "19:00"] },
    { name: "F2", times: ["17:30", "19:00"] },
    { name: "F3", times: ["17:30", "19:00"] },
  ],
};

describe("targetGamesPerTeam", () => {
  it("gives every team the target, no more, in a calendar with room", () => {
    const r = generateSchedule({ ...wide, teams: teams(10), targetGamesPerTeam: 6 });
    const counts = teams(10).map((t) => gamesOf(r.games, t.id).length);
    expect(Math.max(...counts)).toBeLessThanOrEqual(6);
    expect(Math.min(...counts)).toBeGreaterThanOrEqual(5);
    expect(counts.filter((c) => c === 6).length).toBeGreaterThanOrEqual(8);
  });
  it("warns instead of silently under-delivering when the calendar is too short", () => {
    const r = generateSchedule({ ...wide, weeks: 2, teams: teams(10), targetGamesPerTeam: 14 });
    expect(r.warnings.some((w) => /below the target/.test(w))).toBe(true);
  });
});

describe("doubleheaders: avoid", () => {
  it("keeps a team to one game a day when two days are available", () => {
    const r = generateSchedule({
      startDate: "2026-04-18", // Saturday
      daysOfWeek: [6, 0],
      weeks: 6,
      gameMinutes: 90,
      gamesPerWeek: 2,
      weeklyPairing: "different-opponents",
      maxPerTeamPerDay: 2,
      doubleheaders: "avoid",
      fields: [{ name: "F1", times: ["09:00", "11:00", "13:00", "15:00"] }, { name: "F2", times: ["09:00", "11:00", "13:00", "15:00"] }],
      teams: teams(4),
    });
    expect(r.games.length).toBeGreaterThan(0);
    for (const t of teams(4)) {
      const dates = gamesOf(r.games, t.id).map((g) => g.date);
      expect(new Set(dates).size).toBe(dates.length);
    }
  });
});

describe("maxConsecutiveHome / Away", () => {
  it("never lets a team host three in a row", () => {
    const r = generateSchedule({ ...wide, teams: teams(6), maxConsecutiveHome: 2, maxConsecutiveAway: 2 });
    for (const t of teams(6)) {
      let run = 0, worst = 0;
      for (const g of byTime(gamesOf(r.games, t.id))) {
        run = g.home_team_id === t.id ? run + 1 : 0;
        worst = Math.max(worst, run);
      }
      expect(worst).toBeLessThanOrEqual(2);
    }
  });
});

describe("noRematchWeeks", () => {
  it("spaces repeat meetings apart", () => {
    const r = generateSchedule({ ...wide, weeks: 14, teams: teams(4), noRematchWeeks: 3 });
    const meets = new Map<string, number[]>();
    for (const g of r.games) {
      const k = [g.away_team_id, g.home_team_id].sort().join("|");
      meets.set(k, [...(meets.get(k) ?? []), g.week]);
    }
    for (const weeks of meets.values()) {
      const w = [...weeks].sort((a, b) => a - b);
      for (let i = 1; i < w.length; i++) expect(w[i]! - w[i - 1]!).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("per-team maxGamesPerWeek", () => {
  it("caps one team at one game a week while the division plays two", () => {
    const r = generateSchedule({
      ...wide,
      weeks: 10,
      gamesPerWeek: 2,
      weeklyPairing: "different-opponents",
      teams: [{ id: "T1", name: "T1", maxGamesPerWeek: 1 }, ...teams(6).slice(1)],
    });
    const perWeek = new Map<number, number>();
    for (const g of gamesOf(r.games, "T1")) perWeek.set(g.week, (perWeek.get(g.week) ?? 0) + 1);
    for (const n of perWeek.values()) expect(n).toBeLessThanOrEqual(1);
    expect(gamesOf(r.games, "T1").length).toBeGreaterThan(0);
  });
});

describe("weekendBalance", () => {
  it("keeps weekend and weeknight counts within a couple of games", () => {
    const r = generateSchedule({ ...wide, daysOfWeek: [2, 6], weeks: 16, teams: teams(6), weekendBalance: true });
    for (const t of teams(6)) {
      const g = gamesOf(r.games, t.id);
      const wk = g.filter((x) => weekdayOf(x.date) === 6).length;
      const wd = g.length - wk;
      expect(Math.abs(wk - wd)).toBeLessThanOrEqual(3);
    }
  });
});
