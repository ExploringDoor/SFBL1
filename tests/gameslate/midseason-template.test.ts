import { describe, it, expect } from "vitest";
import { generateSchedule } from "@/lib/gameslate/schedule-generator";

const teams = (n: number) => Array.from({ length: n }, (_, i) => ({ id: "T" + (i + 1), name: "T" + (i + 1) }));
const F = [{ name: "F", times: ["09:00", "10:45", "12:30", "14:15", "16:00", "17:45"] }];

describe("home and home", () => {
  it("flips the host when a pair meets again", () => {
    const res = generateSchedule({ teams: teams(4), startDate: "2026-05-02", weeks: 8, daysOfWeek: [6], fields: F, maxCycles: 2, pairAlternate: true });
    const byPair = new Map<string, string[]>();
    for (const g of res.games) {
      const k = [g.away_team_id, g.home_team_id].sort().join("|");
      byPair.set(k, [...(byPair.get(k) ?? []), g.home_team_id]);
    }
    let pairsSeenTwice = 0;
    for (const hosts of byPair.values()) if (hosts.length === 2) { pairsSeenTwice++; expect(hosts[0]).not.toBe(hosts[1]); }
    expect(pairsSeenTwice).toBe(6);
  });
});

describe("mid season rebuild", () => {
  it("skips meetings already played, keeps counting weeks, and seeds home counts", () => {
    const full = generateSchedule({ teams: teams(4), startDate: "2026-05-02", weeks: 6, daysOfWeek: [6], fields: F, maxCycles: 2 });
    const played = full.games.filter((g) => g.date < "2026-05-16");
    const rest = generateSchedule({
      teams: teams(4), startDate: "2026-05-16", weeks: 4, daysOfWeek: [6], fields: F, maxCycles: 2,
      alreadyPlayed: played.map((g) => ({ a: g.away_team_id, b: g.home_team_id, home: g.home_team_id, date: g.date, week: g.week })),
      weekOffset: 2, pairAlternate: true,
    });
    // Total meetings per pair across both halves never exceeds two.
    const count = new Map<string, number>();
    for (const g of [...played, ...rest.games]) { const k = [g.away_team_id, g.home_team_id].sort().join("|"); count.set(k, (count.get(k) ?? 0) + 1); }
    for (const n of count.values()) expect(n).toBeLessThanOrEqual(2);
    expect(rest.games.every((g) => g.week >= 3)).toBe(true);
    // The tail holds exactly what was left: the full season minus the frozen part.
    expect(rest.games.length).toBe(full.games.length - played.length);
    expect(rest.games.every((g) => g.date >= "2026-05-16")).toBe(true);
    // Home and home carries across the boundary: a pair that met once before meets with the other host now.
    for (const g of rest.games) {
      const before = played.find((p) => [p.away_team_id, p.home_team_id].sort().join("|") === [g.away_team_id, g.home_team_id].sort().join("|"));
      if (before) expect(g.home_team_id).not.toBe(before.home_team_id);
    }
  });
});

describe("week template", () => {
  it("uses only the division's starts on that weekday", () => {
    const res = generateSchedule({
      teams: teams(4), startDate: "2026-05-02", weeks: 4, daysOfWeek: [6, 2], fields: [{ name: "F", times: ["09:00", "10:45", "12:30", "17:30", "19:15"] }],
      allowedStartsByDay: { 6: ["09:00", "10:45"] },
    });
    const sat = res.games.filter((g) => new Date(g.date + "T12:00:00").getDay() === 6);
    expect(sat.length).toBeGreaterThan(0);
    for (const g of sat) expect(["09:00", "10:45"]).toContain(g.time);
    const tue = res.games.filter((g) => new Date(g.date + "T12:00:00").getDay() === 2);
    expect(tue.some((g) => g.time === "17:30" || g.time === "19:15")).toBe(true);
  });
});
