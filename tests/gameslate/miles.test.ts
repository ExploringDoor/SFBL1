// gameslate addition: mile based travel radius from field locations.
import { describe, it, expect } from "vitest";
import { generateSchedule, milesBetween } from "@/lib/gameslate/schedule-generator";

const teams = (n: number, extra: object = {}) => Array.from({ length: n }, (_, i) => ({ id: `T${i + 1}`, name: `T${i + 1}`, ...extra }));
// Two parks about 32 miles apart along the same latitude.
const near = { name: "Near Park", times: ["09:00", "11:00", "13:00", "15:00"], lat: 40.0, lng: -75.0 };
const far = { name: "Far Park", times: ["09:00", "11:00", "13:00", "15:00"], lat: 40.0, lng: -75.6 };

describe("milesBetween", () => {
  it("measures the two parks at roughly 32 miles", () => {
    const d = milesBetween(near.lat, near.lng, far.lat, far.lng);
    expect(d).toBeGreaterThan(30); expect(d).toBeLessThan(34);
  });
});

describe("maxMilesFromHome", () => {
  it("a team never plays farther than its radius from its home park", () => {
    const r = generateSchedule({
      startDate: "2026-04-18", daysOfWeek: [6], weeks: 8, gameMinutes: 90, fields: [near, far],
      teams: [{ id: "T1", name: "T1", homeField: "Near Park" }, ...teams(6).slice(1)],
      maxMilesFromHome: 20,
    });
    const t1 = r.games.filter((g) => g.away_team_id === "T1" || g.home_team_id === "T1");
    expect(t1.length).toBeGreaterThan(0);
    for (const g of t1) expect(g.field).toBe("Near Park");
  });
  it("a per-team radius overrides the league radius", () => {
    const r = generateSchedule({
      startDate: "2026-04-18", daysOfWeek: [6], weeks: 8, gameMinutes: 90, fields: [near, far],
      teams: [{ id: "T1", name: "T1", homeField: "Near Park", maxMilesFromHome: 100 }, { id: "T2", name: "T2", homeField: "Near Park" }, ...teams(6).slice(2)],
      maxMilesFromHome: 20,
    });
    const t2 = r.games.filter((g) => g.away_team_id === "T2" || g.home_team_id === "T2");
    for (const g of t2) expect(g.field).toBe("Near Park");
  });
});

describe("maxMilesFromLast", () => {
  it("never sends a team across the county between same day games", () => {
    const r = generateSchedule({
      startDate: "2026-04-18", daysOfWeek: [6], weeks: 6, gameMinutes: 90, gamesPerWeek: 2, weeklyPairing: "different-opponents", maxPerTeamPerDay: 2,
      fields: [near, far], teams: teams(4), maxMilesFromLast: 20,
    });
    for (const t of teams(4)) {
      const byDate: Record<string, Set<string>> = {};
      for (const g of r.games) if (g.away_team_id === t.id || g.home_team_id === t.id) (byDate[g.date] ??= new Set()).add(g.field);
      for (const fields of Object.values(byDate)) expect(fields.size).toBe(1);
    }
  });
});
