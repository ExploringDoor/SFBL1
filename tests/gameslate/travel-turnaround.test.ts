// gameslate additions: field turnaround, travel zones, odd-count doubleheaders, quality dims.
import { describe, it, expect } from "vitest";
import { generateSchedule, scheduleQuality } from "@/lib/gameslate/schedule-generator";

const teams = (n: number, extra: object = {}) => Array.from({ length: n }, (_, i) => ({ id: `T${i + 1}`, name: `T${i + 1}`, ...extra }));
const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

describe("fieldBufferMinutes (turnaround)", () => {
  const base = { startDate: "2026-04-14", daysOfWeek: [2], weeks: 6, gameMinutes: 90, teams: teams(4) };
  it("keeps games on one field at least gameMinutes + buffer apart", () => {
    const r = generateSchedule({ ...base, fields: [{ name: "F1", times: ["17:00", "18:30", "20:00"] }], fieldBufferMinutes: 15 });
    const byDateField: Record<string, number[]> = {};
    for (const g of r.games) (byDateField[g.date + g.field] ??= []).push(mins(g.time));
    for (const starts of Object.values(byDateField)) {
      const s = [...starts].sort((a, b) => a - b);
      for (let i = 1; i < s.length; i++) expect(s[i]! - s[i - 1]!).toBeGreaterThanOrEqual(105);
    }
  });
  it("without a buffer, adjacent slots are both usable", () => {
    const r = generateSchedule({ ...base, fields: [{ name: "F1", times: ["17:00", "18:30", "20:00"] }] });
    const some = Object.values(r.games.reduce((m: Record<string, number>, g) => { m[g.date] = (m[g.date] ?? 0) + 1; return m; }, {}));
    expect(Math.max(...some)).toBeGreaterThanOrEqual(2);
  });
});

describe("travel zones", () => {
  it("with a hard cap of zero, a team never leaves its zone when an in-zone field exists", () => {
    const r = generateSchedule({
      startDate: "2026-04-14", daysOfWeek: [2, 4], weeks: 8, gameMinutes: 90,
      fields: [{ name: "North Park", times: ["17:30", "19:00"], zone: "north" }, { name: "South Park", times: ["17:30", "19:00"], zone: "south" }],
      teams: teams(4, { zone: "north" }),
      maxOutOfZonePerWeek: 0,
    });
    expect(r.games.length).toBeGreaterThan(0);
    for (const g of r.games) expect(g.field).toBe("North Park");
  });
  it("with only the soft penalty, most games stay in zone", () => {
    const r = generateSchedule({
      startDate: "2026-04-14", daysOfWeek: [2], weeks: 8, gameMinutes: 90,
      fields: [{ name: "North Park", times: ["17:30", "19:00"], zone: "north" }, { name: "South Park", times: ["17:30", "19:00"], zone: "south" }],
      teams: teams(4, { zone: "north" }),
    });
    const inZone = r.games.filter((g) => g.field === "North Park").length;
    expect(inZone / r.games.length).toBeGreaterThanOrEqual(0.7);
  });
});

describe("oddTeams: doubleheader instead of a bye", () => {
  const base = {
    startDate: "2026-04-18", daysOfWeek: [6], weeks: 5, gameMinutes: 90, maxPerTeamPerDay: 2,
    fields: [{ name: "F1", times: ["09:00", "11:00", "13:00", "15:00"] }, { name: "F2", times: ["09:00", "11:00", "13:00", "15:00"] }],
    teams: teams(5),
  };
  it("everyone plays every week", () => {
    const r = generateSchedule({ ...base, oddTeams: "doubleheader" });
    const weeks = new Set(r.games.map((g) => g.week));
    for (const w of weeks) {
      const playing = new Set(r.games.filter((g) => g.week === w).flatMap((g) => [g.away_team_id, g.home_team_id]));
      expect(playing.size).toBe(5);
    }
  });
  it("by default one team sits each week", () => {
    const r = generateSchedule(base);
    const w1 = new Set(r.games.filter((g) => g.week === 1).flatMap((g) => [g.away_team_id, g.home_team_id]));
    expect(w1.size).toBe(4);
  });
});

describe("scheduleQuality dimensions", () => {
  it("reports venue and weekend balance in range", () => {
    const r = generateSchedule({ startDate: "2026-04-14", daysOfWeek: [2, 6], weeks: 8, gameMinutes: 90, fields: [{ name: "A", times: ["17:30"] }, { name: "B", times: ["17:30"] }], teams: teams(6) });
    const q = scheduleQuality(r.games, 0);
    expect(q.fieldFairness).toBeGreaterThanOrEqual(0); expect(q.fieldFairness).toBeLessThanOrEqual(1);
    expect(q.weekendBalance).toBeGreaterThanOrEqual(0); expect(q.weekendBalance).toBeLessThanOrEqual(1);
    expect(q.score).toBeGreaterThanOrEqual(0); expect(q.score).toBeLessThanOrEqual(100);
  });
});
