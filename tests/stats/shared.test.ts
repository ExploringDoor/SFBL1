import { describe, expect, it } from "vitest";
import {
  battingAverage,
  computeStandings,
  onBasePct,
  ops,
  sluggingPct,
  type GameResult,
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
});
