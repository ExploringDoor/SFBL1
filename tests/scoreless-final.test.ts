// A game marked final with no score must not become a 0-0 tie.
//
// WHY THIS FILE EXISTS. Adam, 2026-09-10, four days before Island's opening
// day: "make sure that all the scores / standings / all of that will update
// correctly when they are putting in scores, audit it very well."
//
// The audit found this. The admin Schedule tab offers a status dropdown with
// "final" in it, and the score boxes it reveals were optional. Save one blank
// and the game doc came out status:"final" with no score fields. Every surface
// then read `Number(data.home_score ?? 0)` — standings, team pages, homepage,
// schedule, scores — so both teams silently collected a TIE and a game played.
// A tie looks like a result, so nobody reports it as a bug; it just quietly
// moves two teams in the table.
//
// Mike's most likely way in: a rained-out or forfeited game flipped to "final"
// to get it off the schedule.

import { describe, it, expect } from "vitest";
import {
  computeStandings,
  computeStandingsWithExtraGameRule,
  scoreOrNull,
  countsInStandings,
  type GameResult,
} from "@/lib/stats/shared";

const g = (
  away: string,
  home: string,
  as: number | null,
  hs: number | null,
  status: GameResult["status"] = "final",
  date = "2026-09-14",
): GameResult => ({
  away_team_id: away,
  home_team_id: home,
  away_score: as,
  home_score: hs,
  status,
  date,
});

describe("scoreOrNull", () => {
  it("keeps a real score, including zero", () => {
    expect(scoreOrNull(0)).toBe(0);
    expect(scoreOrNull(7)).toBe(7);
    expect(scoreOrNull("4")).toBe(4);
  });
  it("does NOT invent a zero for a missing score", () => {
    expect(scoreOrNull(undefined)).toBeNull();
    expect(scoreOrNull(null)).toBeNull();
    expect(scoreOrNull("")).toBeNull();
    expect(scoreOrNull("abc")).toBeNull();
    expect(scoreOrNull(NaN)).toBeNull();
  });
});

describe("countsInStandings", () => {
  it("counts a scored final and a scored approved game", () => {
    expect(countsInStandings(g("a", "b", 4, 7))).toBe(true);
    expect(countsInStandings(g("a", "b", 4, 7, "approved"))).toBe(true);
  });
  it("counts a real 0-0 tie", () => {
    expect(countsInStandings(g("a", "b", 0, 0))).toBe(true);
  });
  it("skips a final with either score missing", () => {
    expect(countsInStandings(g("a", "b", null, null))).toBe(false);
    expect(countsInStandings(g("a", "b", 4, null))).toBe(false);
    expect(countsInStandings(g("a", "b", null, 7))).toBe(false);
  });
  it("skips games that have not finished", () => {
    for (const s of ["scheduled", "live", "postponed", "draft"] as const) {
      expect(countsInStandings(g("a", "b", 4, 7, s))).toBe(false);
    }
  });
});

describe("a scoreless final does not move the standings", () => {
  it("gives nobody a tie, a win, a loss or a game played", () => {
    const rows = computeStandings([g("a", "b", null, null)]);
    expect(rows).toHaveLength(0);
  });

  it("leaves a real result untouched when a scoreless final sits beside it", () => {
    const rows = computeStandings([
      g("a", "b", 4, 7, "final", "2026-09-14"),
      g("a", "b", null, null, "final", "2026-09-21"),
    ]);
    const b = rows.find((r) => r.team_id === "b")!;
    const a = rows.find((r) => r.team_id === "a")!;
    expect([b.w, b.l, b.t, b.gp]).toEqual([1, 0, 0, 1]);
    expect([a.w, a.l, a.t, a.gp]).toEqual([0, 1, 0, 1]);
    expect(b.streak).toBe("W1");
  });

  it("is the behaviour the old code had wrong: 0 is not the same as blank", () => {
    // The real 0-0 forfeit-style tie still counts...
    const real = computeStandings([g("a", "b", 0, 0)]);
    expect(real.find((r) => r.team_id === "a")!.t).toBe(1);
    // ...and the blank one does not.
    const blank = computeStandings([g("a", "b", null, null)]);
    expect(blank).toHaveLength(0);
  });

  it("holds through the extra-game-loss wrapper Island runs", () => {
    const rows = computeStandingsWithExtraGameRule(
      [g("a", "b", null, null), g("c", "d", 3, 1)],
      { enabled: false, divisionOf: () => "10U" },
    );
    expect(rows.map((r) => r.team_id).sort()).toEqual(["c", "d"]);
  });

  it("holds under head-to-head tiebreaking", () => {
    const rows = computeStandingsWithExtraGameRule(
      [
        g("a", "b", 5, 3, "final", "2026-09-14"),
        g("b", "a", 2, 9, "final", "2026-09-21"),
        g("a", "b", null, null, "final", "2026-09-28"),
      ],
      { tiebreaker: "h2h", divisionOf: () => "10U" },
    );
    // a won both played games (5-3 away, then 9-2 at home). The blank one
    // must add nothing to either side.
    const a = rows.find((r) => r.team_id === "a")!;
    const b = rows.find((r) => r.team_id === "b")!;
    expect(a.gp).toBe(2);
    expect([a.w, a.l, a.t]).toEqual([2, 0, 0]);
    expect([b.w, b.l, b.t, b.gp]).toEqual([0, 2, 0, 2]);
  });
});
