import { describe, it, expect } from "vitest";
import { generateSchedule } from "@/lib/gameslate/schedule-generator";

const names = (n: number) => Array.from({ length: n }, (_, i) => "T" + (i + 1));
const gamesOf = (res: ReturnType<typeof generateSchedule>, id: string) =>
  res.games.filter((g) => g.away_team_id === id || g.home_team_id === id).length;

describe("per team season target", () => {
  it("a travel team stops at its own count while the league keeps going", () => {
    const teams = names(6).map((n) => ({ id: n, name: n, ...(n === "T1" ? { targetGames: 4 } : {}) }));
    const res = generateSchedule({
      teams, startDate: "2026-04-06", weeks: 10, daysOfWeek: [1, 3],
      fields: [{ name: "F", times: ["18:00", "19:45", "21:30"] }], targetGamesPerTeam: 10,
    });
    expect(gamesOf(res, "T1")).toBe(4);
    expect(gamesOf(res, "T2")).toBeGreaterThan(4);
  });
});

describe("drive minutes", () => {
  const teams = [
    { id: "A", name: "A", homeField: "North" },
    { id: "B", name: "B", homeField: "South" },
    { id: "C", name: "C" },
    { id: "D", name: "D" },
  ];
  const fields = ["North", "South", "Mid"].map((n) => ({ name: n, times: ["18:00", "19:45"] }));
  const driveMinutes = {
    North: { South: 55, Mid: 20 },
    South: { North: 55, Mid: 25 },
    Mid: { North: 20, South: 25 },
  };
  it("keeps a team inside its drive time from home", () => {
    const res = generateSchedule({ teams, startDate: "2026-05-04", weeks: 6, daysOfWeek: [1, 2, 3, 4], fields, driveMinutes, maxMinutesFromHome: 30 });
    expect(res.games.length).toBeGreaterThan(0);
    for (const g of res.games) {
      const at = g.field;
      for (const t of [g.away_team_id, g.home_team_id]) {
        if (t === "A") expect(at).not.toBe("South");
        if (t === "B") expect(at).not.toBe("North");
      }
    }
  });
  it("uses the pair's road minutes as the same day gap between different fields", () => {
    const res = generateSchedule({
      teams, startDate: "2026-05-02", weeks: 4, daysOfWeek: [6], gameMinutes: 60, gamesPerWeek: 2, doubleheaders: "prefer",
      fields: [{ name: "North", times: ["09:00", "10:00", "11:00", "12:00"] }, { name: "South", times: ["09:00", "10:00", "11:00", "12:00"] }],
      driveMinutes, maxPerTeamPerDay: 2,
    });
    // Any team with two games on one day at different fields has at least 55 minutes between them.
    const byTeamDay = new Map<string, { t: number; f: string }[]>();
    for (const g of res.games) for (const t of [g.away_team_id, g.home_team_id]) {
      const k = g.date + "|" + t; const m = Number(g.time.slice(0, 2)) * 60 + Number(g.time.slice(3));
      byTeamDay.set(k, [...(byTeamDay.get(k) ?? []), { t: m, f: g.field }]);
    }
    for (const list of byTeamDay.values()) {
      if (list.length < 2) continue;
      list.sort((x, y) => x.t - y.t);
      for (let i = 1; i < list.length; i++) {
        if (list[i]!.f !== list[i - 1]!.f) expect(list[i]!.t - (list[i - 1]!.t + 60)).toBeGreaterThanOrEqual(55);
      }
    }
  });
});

describe("max idle days", () => {
  it("rotates the bye so nobody sits two weeks in a row, and reports overruns", () => {
    // Five teams, one field, two slots: two games a week, one team sits.
    const teams = names(5).map((n) => ({ id: n, name: n }));
    const base = { teams, startDate: "2026-04-04", weeks: 10, daysOfWeek: [6], fields: [{ name: "F", times: ["09:00", "11:00"] }] };
    const res = generateSchedule({ ...base, maxIdleDays: 14 });
    const worst = (r: typeof res) => {
      let w = 0;
      for (const t of teams) {
        const ds = r.games.filter((g) => g.away_team_id === t.id || g.home_team_id === t.id).map((g) => Date.parse(g.date)).sort((a, b) => a - b);
        for (let i = 1; i < ds.length; i++) w = Math.max(w, (ds[i]! - ds[i - 1]!) / 86400000);
      }
      return w;
    };
    expect(worst(res)).toBeLessThanOrEqual(14);
    expect(res.warnings.some((w) => /without a game/.test(w))).toBe(false);
    const tight = generateSchedule({ ...base, maxIdleDays: 7 });
    expect(tight.warnings.some((w) => /without a game/.test(w))).toBe(true);
  });
});
