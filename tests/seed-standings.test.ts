// Showing the standings before a ball is thrown.
//
// computeStandings only counts FINISHED games, so Island's homepage showed
// "Standings will appear here after the first game is final" next to a full
// slate of 92 scheduled fixtures. Mike asked to see the table at zeros.

import { describe, expect, it } from "vitest";
import { seedStandingsWithAllTeams, type StandingsRow } from "@/lib/stats/shared";

const row = (team_id: string, w: number, l: number): StandingsRow => ({
  team_id, gp: w + l, w, l, t: 0, rs: 0, ra: 0, rd: 0, pct: 0, gb: 0,
});

describe("seedStandingsWithAllTeams", () => {
  it("gives every team a row when nothing has been played", () => {
    const out = seedStandingsWithAllTeams([], ["a", "b", "c"]);
    expect(out.map((r) => r.team_id)).toEqual(["a", "b", "c"]);
    expect(out.every((r) => r.w === 0 && r.l === 0 && r.gp === 0)).toBe(true);
  });

  it("leaves an existing row completely alone", () => {
    const played = row("a", 3, 1);
    const out = seedStandingsWithAllTeams([played], ["a", "b"]);
    expect(out.find((r) => r.team_id === "a")).toEqual(played);
  });

  it("adds only the teams that are missing", () => {
    const out = seedStandingsWithAllTeams([row("a", 1, 0)], ["a", "b"]);
    expect(out).toHaveLength(2);
    expect(out.find((r) => r.team_id === "b")!.gp).toBe(0);
  });

  it("does not invent a streak or recent form", () => {
    const [r] = seedStandingsWithAllTeams([], ["a"]);
    expect(r!.streak).toBeUndefined();
    expect(r!.recent).toBeUndefined();
  });

  it("ignores a blank team id", () => {
    expect(seedStandingsWithAllTeams([], ["", "a"]).map((r) => r.team_id)).toEqual(["a"]);
  });

  it("changes nothing when every team already has a row", () => {
    const rows = [row("a", 2, 0), row("b", 0, 2)];
    expect(seedStandingsWithAllTeams(rows, ["a", "b"])).toEqual(rows);
  });

  it("returns the played rows unchanged when the team list is empty", () => {
    const rows = [row("a", 1, 1)];
    expect(seedStandingsWithAllTeams(rows, [])).toEqual(rows);
  });
});
