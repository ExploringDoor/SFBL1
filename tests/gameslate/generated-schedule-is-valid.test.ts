import { describe, it, expect } from "vitest";
import { generateSchedule } from "@/lib/gameslate/schedule-generator";
import { findConflicts } from "@/lib/gameslate/schedule-conflicts";

// The engine promises that a schedule it generates always passes its own
// conflict checker. That was not true: slots inside one booking window were
// checked against games already on the board but never against each other, so
// a same-opponent doubleheader could be handed two overlapping slots. The
// suite missed it because its doubleheader cases ran with no game length, and
// overlap detection needs one.
const teams = (n: number) => Array.from({ length: n }, (_, i) => ({ id: "T" + (i + 1), name: "T" + (i + 1) }));
const errorsIn = (res: any, gameMinutes: number) =>
  findConflicts(res.games, { gameMinutes }).filter((c: any) => c.severity === "error");

describe("a generated schedule always passes the conflict checker", () => {
  it("the reported doubleheader case", () => {
    const res = generateSchedule({
      teams: teams(4), fields: [{ name: "Cedar Hill", times: ["12:00", "13:30", "20:30"] }],
      startDate: "2026-04-10", weeks: 3, daysOfWeek: [5],
      gameMinutes: 120, gamesPerWeek: 2, weeklyPairing: "same-opponent", minGapMinutes: 30,
    } as any);
    expect(res.games.length).toBeGreaterThan(0);
    expect(errorsIn(res, 120)).toEqual([]);
  });

  // Sweep the shape that produced overlaps: doubleheaders, long games, tight
  // time lists. Every one of these used to be able to emit an invalid board.
  const cases: Array<[string, any]> = [];
  for (const nTeams of [4, 6, 8]) {
    for (const gameMinutes of [90, 120]) {
      for (const times of [["12:00", "13:30", "20:30"], ["09:00", "10:30", "12:00", "13:30"], ["17:30", "19:00"]]) {
        for (const pairing of ["same-opponent", "different-opponents"]) {
          cases.push([`${nTeams} teams, ${gameMinutes}min, ${times.length} slots, ${pairing}`, {
            teams: teams(nTeams), fields: [{ name: "Main", times }],
            startDate: "2026-04-10", weeks: 4, daysOfWeek: [5],
            gameMinutes, gamesPerWeek: 2, weeklyPairing: pairing,
          }]);
        }
      }
    }
  }
  it.each(cases)("%s", (_label, cfg: any) => {
    expect(errorsIn(generateSchedule(cfg), cfg.gameMinutes)).toEqual([]);
  });

  it("honours a minimum gap between a team's two games in a day", () => {
    const res = generateSchedule({
      teams: teams(4), fields: [{ name: "Main", times: ["10:00", "11:00", "12:00", "17:00"] }],
      startDate: "2026-04-10", weeks: 2, daysOfWeek: [5],
      gameMinutes: 60, gamesPerWeek: 2, weeklyPairing: "same-opponent", minGapMinutes: 120,
    } as any);
    const byTeamDay: Record<string, number[]> = {};
    for (const g of res.games as any[]) {
      const m = Number(g.time.slice(0, 2)) * 60 + Number(g.time.slice(3, 5));
      for (const t of [g.away_team_id, g.home_team_id]) (byTeamDay[t + "|" + g.date] ||= []).push(m);
    }
    for (const k of Object.keys(byTeamDay)) {
      const v = byTeamDay[k]!.sort((x, y) => x - y);
      for (let i = 1; i < v.length; i++) expect(v[i]! - (v[i - 1]! + 60)).toBeGreaterThanOrEqual(120);
    }
  });
});
