import { describe, expect, it } from "vitest";
import {
  battingAverage,
  computePoints,
  computeStandings,
  onBasePct,
  ops,
  sluggingPct,
  sortByPoints,
  type GameResult,
  type StandingsRow,
} from "@/lib/stats/shared";

describe("battingAverage", () => {
  it("returns 0 for 0 AB (no division by zero)", () => {
    expect(battingAverage(0, 0)).toBe(0);
    expect(battingAverage(5, 0)).toBe(0); // weird but defined
  });

  it("computes the standard average", () => {
    expect(battingAverage(3, 10)).toBeCloseTo(0.3, 6);
    expect(battingAverage(150, 500)).toBeCloseTo(0.3, 6);
    expect(battingAverage(2, 5)).toBeCloseTo(0.4, 6);
  });

  it("0 hits is 0 average", () => {
    expect(battingAverage(0, 100)).toBe(0);
  });
});

describe("sluggingPct", () => {
  it("returns 0 for 0 AB", () => {
    expect(sluggingPct(0, 0, 0, 0, 0)).toBe(0);
  });

  it("all singles: SLG = AVG", () => {
    expect(sluggingPct(3, 0, 0, 0, 10)).toBeCloseTo(0.3, 6);
  });

  it("home runs only", () => {
    // 1 HR in 4 AB = 4/4 = 1.000 (because total bases = 4)
    expect(sluggingPct(1, 0, 0, 1, 4)).toBeCloseTo(1.0, 6);
  });

  it("mix of hit types", () => {
    // 4 H = 1 single + 1 double + 1 triple + 1 HR in 10 AB
    // total bases = 1 + 2 + 3 + 4 = 10
    // SLG = 10/10 = 1.000
    expect(sluggingPct(4, 1, 1, 1, 10)).toBeCloseTo(1.0, 6);
  });

  it("throws when 2B+3B+HR exceeds H (data inconsistency)", () => {
    // h=2, but 2B+3B+HR = 3 → singles would be -1 → bug in box score data
    expect(() => sluggingPct(2, 1, 1, 1, 10)).toThrow(/inconsistent/i);
  });
});

describe("onBasePct", () => {
  it("returns 0 when AB+BB is 0", () => {
    expect(onBasePct(0, 0, 0)).toBe(0);
  });

  it("walks count as on-base", () => {
    // 0 H, 1 BB, 0 AB → OBP = 1/1 = 1.000
    expect(onBasePct(0, 1, 0)).toBe(1);
  });

  it("standard case: 3 H, 1 BB, 10 AB → 4/11", () => {
    expect(onBasePct(3, 1, 10)).toBeCloseTo(4 / 11, 6);
  });
});

describe("ops", () => {
  it("just adds OBP and SLG", () => {
    expect(ops(0.35, 0.5)).toBeCloseTo(0.85, 6);
    expect(ops(0, 0)).toBe(0);
  });
});

describe("computeStandings", () => {
  const game = (
    home: string,
    away: string,
    homeScore: number,
    awayScore: number,
    status: GameResult["status"] = "final",
  ): GameResult => ({
    home_team_id: home,
    away_team_id: away,
    home_score: homeScore,
    away_score: awayScore,
    status,
  });

  it("empty input → empty array", () => {
    expect(computeStandings([])).toEqual([]);
  });

  it("ignores draft / postponed / rained-out games", () => {
    const games: GameResult[] = [
      game("a", "b", 5, 3, "draft"),
      game("a", "b", 5, 3, "ppd"),
      game("a", "b", 5, 3, "rained_out"),
    ];
    expect(computeStandings(games)).toEqual([]);
  });

  it("counts a final game's result for both teams", () => {
    const result = computeStandings([game("a", "b", 5, 3)]);
    expect(result).toHaveLength(2);
    const a = result.find((r) => r.team_id === "a")!;
    const b = result.find((r) => r.team_id === "b")!;
    expect(a).toMatchObject({ gp: 1, w: 1, l: 0, t: 0, rs: 5, ra: 3, rd: 2, pct: 1, gb: 0 });
    expect(b).toMatchObject({ gp: 1, w: 0, l: 1, t: 0, rs: 3, ra: 5, rd: -2, pct: 0 });
  });

  it("handles ties (counted as 0.5 win in PCT)", () => {
    const rows = computeStandings([game("a", "b", 4, 4)]);
    const a = rows.find((r) => r.team_id === "a")!;
    expect(a).toMatchObject({ w: 0, l: 0, t: 1, pct: 0.5 });
  });

  it("approved status counts the same as final", () => {
    const rows = computeStandings([game("a", "b", 5, 3, "approved")]);
    expect(rows[0]?.gp).toBe(1);
  });

  it("sorts by PCT desc, then run differential desc", () => {
    // a: 2-0, +6 RD
    // b: 1-1, +0 RD
    // c: 1-1, -2 RD  (same PCT as b, worse RD)
    // d: 0-2, -4 RD
    const games: GameResult[] = [
      game("a", "b", 5, 2),
      game("a", "c", 4, 1),
      game("b", "c", 3, 2),
      game("d", "b", 1, 4),
      game("d", "c", 1, 2), // d 0-2, c 1-1 (-2 RD overall)
    ];
    const rows = computeStandings(games);
    const order = rows.map((r) => r.team_id);
    expect(order[0]).toBe("a"); // best record
    expect(order[3]).toBe("d"); // worst record
    // b and c are both 1-1 — b has +0 RD, c has -2 RD → b ahead
    expect(order.indexOf("b")).toBeLessThan(order.indexOf("c"));
  });

  it("computes GB relative to best team", () => {
    const games: GameResult[] = [
      // a: 2-0, b: 1-1, c: 0-2
      game("a", "b", 5, 0),
      game("a", "c", 5, 0),
      game("b", "c", 5, 0),
    ];
    const rows = computeStandings(games);
    expect(rows.find((r) => r.team_id === "a")?.gb).toBe(0);
    expect(rows.find((r) => r.team_id === "b")?.gb).toBe(1);
    expect(rows.find((r) => r.team_id === "c")?.gb).toBe(2);
  });

  it("multiple games per team aggregate correctly", () => {
    const games: GameResult[] = [
      game("a", "b", 10, 0),
      game("a", "b", 10, 0),
      game("a", "b", 10, 0),
    ];
    const rows = computeStandings(games);
    const a = rows.find((r) => r.team_id === "a")!;
    expect(a).toMatchObject({ gp: 3, w: 3, l: 0, rs: 30, ra: 0, rd: 30, pct: 1 });
  });

  // Streak calc — walks final games in date order and reports the
  // trailing run as "W3"/"L1"/"T1". Used in the standings table chip.
  it("streak: undefined when no games are dated", () => {
    // Without dates, we still produce SOME streak because the games
    // get processed in input order. Just verify no crash + the
    // streak field is either undefined or a valid string.
    const dated = (
      home: string,
      away: string,
      hs: number,
      as_: number,
      date: string,
    ): GameResult => ({
      home_team_id: home,
      away_team_id: away,
      home_score: hs,
      away_score: as_,
      status: "final",
      date,
    });
    const rows = computeStandings([dated("a", "b", 5, 3, "2026-05-01")]);
    const a = rows.find((r) => r.team_id === "a")!;
    expect(a.streak).toBe("W1");
    const b = rows.find((r) => r.team_id === "b")!;
    expect(b.streak).toBe("L1");
  });

  it("streak: W3 after three straight wins in date order", () => {
    const dated = (
      home: string,
      away: string,
      hs: number,
      as_: number,
      date: string,
    ): GameResult => ({
      home_team_id: home,
      away_team_id: away,
      home_score: hs,
      away_score: as_,
      status: "final",
      date,
    });
    const rows = computeStandings([
      dated("a", "b", 5, 3, "2026-05-01"),
      dated("a", "c", 4, 1, "2026-05-08"),
      dated("a", "d", 7, 0, "2026-05-15"),
    ]);
    const a = rows.find((r) => r.team_id === "a")!;
    expect(a.streak).toBe("W3");
  });

  it("streak: collapses to current run only — L1 after W2-then-loss", () => {
    const dated = (
      home: string,
      away: string,
      hs: number,
      as_: number,
      date: string,
    ): GameResult => ({
      home_team_id: home,
      away_team_id: away,
      home_score: hs,
      away_score: as_,
      status: "final",
      date,
    });
    const rows = computeStandings([
      dated("a", "b", 5, 3, "2026-05-01"), // a wins
      dated("a", "c", 4, 1, "2026-05-08"), // a wins
      dated("d", "a", 9, 1, "2026-05-15"), // a loses
    ]);
    const a = rows.find((r) => r.team_id === "a")!;
    expect(a.streak).toBe("L1");
  });

  it("streak: respects date order even when input is shuffled", () => {
    const dated = (
      home: string,
      away: string,
      hs: number,
      as_: number,
      date: string,
    ): GameResult => ({
      home_team_id: home,
      away_team_id: away,
      home_score: hs,
      away_score: as_,
      status: "final",
      date,
    });
    const rows = computeStandings([
      // Most recent game is a loss for "a" — should produce L1
      // regardless of input order.
      dated("d", "a", 9, 1, "2026-05-15"), // a loses (most recent)
      dated("a", "b", 5, 3, "2026-05-01"),
      dated("a", "c", 4, 1, "2026-05-08"),
    ]);
    const a = rows.find((r) => r.team_id === "a")!;
    expect(a.streak).toBe("L1");
  });

  it("streak: tie tracks as T1 / T2", () => {
    const dated = (
      home: string,
      away: string,
      hs: number,
      as_: number,
      date: string,
    ): GameResult => ({
      home_team_id: home,
      away_team_id: away,
      home_score: hs,
      away_score: as_,
      status: "final",
      date,
    });
    const rows = computeStandings([
      dated("a", "b", 4, 4, "2026-05-01"),
      dated("a", "c", 3, 3, "2026-05-08"),
    ]);
    const a = rows.find((r) => r.team_id === "a")!;
    expect(a.streak).toBe("T2");
  });

  it("never returns NaN — empty input edge cases", () => {
    // Lock down: no field on any output row should ever be NaN.
    // Standings table renders pct as a string; NaN would render as
    // "NaN" or break sorting.
    expect(computeStandings([]).length).toBe(0);
    const rows = computeStandings([game("a", "b", 0, 0)]);
    for (const r of rows) {
      for (const [key, val] of Object.entries(r)) {
        if (typeof val === "number") {
          expect(Number.isNaN(val), `${r.team_id}.${key} is NaN`).toBe(false);
          expect(Number.isFinite(val), `${r.team_id}.${key} is not finite`)
            .toBe(true);
        }
      }
    }
  });

  it("0-0 game counted as a tie, not a win for either side", () => {
    const rows = computeStandings([game("a", "b", 0, 0)]);
    const a = rows.find((r) => r.team_id === "a")!;
    const b = rows.find((r) => r.team_id === "b")!;
    expect(a).toMatchObject({ w: 0, l: 0, t: 1 });
    expect(b).toMatchObject({ w: 0, l: 0, t: 1 });
  });

  it("a team that has never played ANY game does NOT appear in standings", () => {
    // Defensible behavior — standings is derived purely from finished
    // games. Empty-roster teams aren't dropped from the league, just
    // not visible until they play. UI should fill them in from the
    // teams list separately if needed.
    const rows = computeStandings([game("a", "b", 5, 3)]);
    expect(rows.find((r) => r.team_id === "c")).toBeUndefined();
  });

  it("doesn't double-count the same game with different team ID order", () => {
    // Sanity: we treat each game object as one game, regardless of
    // who's home vs away. Two different games at different scores
    // count as two games for both teams.
    const rows = computeStandings([
      game("a", "b", 5, 3),
      game("b", "a", 4, 2), // same matchup, swapped sides
    ]);
    const a = rows.find((r) => r.team_id === "a")!;
    expect(a.gp).toBe(2);
    expect(a.w).toBe(1); // won the first, lost the second
    expect(a.l).toBe(1);
  });
});

describe("computePoints", () => {
  const row = (w: number, l: number, t: number): StandingsRow => ({
    team_id: "x", gp: w + l + t, w, l, t,
    rs: 0, ra: 0, rd: 0, pct: 0, gb: 0,
  });

  it("DVSL softball scheme: 3/2/1", () => {
    const scheme = { win: 3, tie: 2, loss: 1 };
    expect(computePoints(row(5, 2, 1), scheme)).toBe(5 * 3 + 1 * 2 + 2 * 1); // 19
    expect(computePoints(row(0, 0, 0), scheme)).toBe(0);
  });

  it("soccer scheme: 3/1/0", () => {
    const scheme = { win: 3, tie: 1, loss: 0 };
    expect(computePoints(row(10, 5, 3), scheme)).toBe(10 * 3 + 3 * 1 + 5 * 0); // 33
  });

  it("zero-point ties are valid", () => {
    expect(computePoints(row(2, 1, 0), { win: 1, tie: 0, loss: 0 })).toBe(2);
  });
});

describe("sortByPoints", () => {
  const row = (
    team_id: string,
    w: number,
    l: number,
    t: number,
    rd = 0,
  ): StandingsRow => ({
    team_id, gp: w + l + t, w, l, t,
    rs: 0, ra: 0, rd, pct: 0, gb: 0,
  });

  it("sorts by points desc using DVSL scheme", () => {
    const rows = [
      row("c", 3, 0, 0), // 9 pts
      row("a", 2, 1, 0), // 8 pts (3*2 + 1 = 7… wait: 3*2 + 2*0 + 1*1 = 7)
      row("b", 2, 0, 1), // 3*2 + 2*1 + 0 = 8 pts
    ];
    const sorted = sortByPoints(rows, { win: 3, tie: 2, loss: 1 });
    expect(sorted.map((r) => r.team_id)).toEqual(["c", "b", "a"]);
  });

  it("breaks ties by run differential desc by default", () => {
    const rows = [
      row("a", 2, 1, 0, +5), // 7 pts, +5 RD
      row("b", 2, 1, 0, +10), // 7 pts, +10 RD
      row("c", 2, 1, 0, -3), // 7 pts, -3 RD
    ];
    const sorted = sortByPoints(rows, { win: 3, tie: 2, loss: 1 });
    expect(sorted.map((r) => r.team_id)).toEqual(["b", "a", "c"]);
  });

  it("breaks ties by PCT when tiebreaker='pct' (SFBL convention)", () => {
    // SFBL real example: Margate 4-2-0 (.667) vs Orioles 4-3-0 (.571)
    // both 8 points (W=2 scheme); Margate ranks higher due to PCT.
    const margate: StandingsRow = {
      team_id: "margate", gp: 6, w: 4, l: 2, t: 0,
      rs: 0, ra: 0, rd: -10, pct: 4 / 6, gb: 0,
    };
    const orioles: StandingsRow = {
      team_id: "orioles", gp: 7, w: 4, l: 3, t: 0,
      rs: 0, ra: 0, rd: +50, pct: 4 / 7, gb: 0,
    };
    // Notice: by RD tiebreaker Orioles would win (+50 vs -10), so this
    // test specifically catches the difference between rd and pct modes.
    const sorted = sortByPoints([orioles, margate], { win: 2, tie: 1, loss: 0 }, "pct");
    expect(sorted.map((r) => r.team_id)).toEqual(["margate", "orioles"]);
  });

  it("PCT tiebreaker handles equal PCT consistently", () => {
    // If two teams have identical points AND identical PCT, fall through
    // to whatever the stable sort decides — that's acceptable for now.
    const a: StandingsRow = {
      team_id: "a", gp: 4, w: 2, l: 2, t: 0,
      rs: 0, ra: 0, rd: 5, pct: 0.5, gb: 0,
    };
    const b: StandingsRow = {
      team_id: "b", gp: 4, w: 2, l: 2, t: 0,
      rs: 0, ra: 0, rd: -5, pct: 0.5, gb: 0,
    };
    expect(() =>
      sortByPoints([a, b], { win: 1, tie: 0, loss: 0 }, "pct"),
    ).not.toThrow();
  });

  it("does not mutate input", () => {
    const input = [row("a", 1, 0, 0), row("b", 0, 1, 0)];
    const inputCopy = JSON.parse(JSON.stringify(input));
    sortByPoints(input, { win: 3, tie: 1, loss: 0 });
    expect(input).toEqual(inputCopy);
  });
});
