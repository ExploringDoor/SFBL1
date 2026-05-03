import { describe, expect, it } from "vitest";
import {
  aggregateBatting,
  aggregatePitching,
  batterStatsAreEqual,
  pitcherStatsAreEqual,
  type BaseballBattingLine,
  type BaseballBatterStats,
  type BaseballPitchingLine,
  type BaseballPitcherStats,
} from "@/lib/stats/baseball";
import { ipFromInningsAndOuts, parseIP } from "@/lib/stats/ip";

const battingLine = (
  player_id: string,
  o: Partial<BaseballBattingLine> = {},
): BaseballBattingLine => ({
  player_id,
  ab: 0, r: 0, h: 0, doubles: 0, triples: 0, hr: 0,
  rbi: 0, bb: 0, so: 0,
  ...o,
});

const pitchingLine = (
  player_id: string,
  o: Partial<BaseballPitchingLine> = {},
): BaseballPitchingLine => ({
  player_id,
  ip_outs: 0, h: 0, r: 0, er: 0, bb: 0, so: 0, hr: 0,
  ...o,
});

// =============================================================================
// Batting
// =============================================================================

describe("baseball aggregateBatting", () => {
  it("empty input → empty output", () => {
    expect(aggregateBatting([])).toEqual([]);
  });

  it("aggregates and computes derived stats on totals", () => {
    const result = aggregateBatting([
      battingLine("p1", { ab: 4, h: 2, doubles: 1, rbi: 1, bb: 1 }),
      battingLine("p1", { ab: 4, h: 1, hr: 1, rbi: 2 }),
    ]);
    expect(result).toHaveLength(1);
    const p = result[0]!;
    expect(p.gp).toBe(2);
    expect(p.ab).toBe(8);
    expect(p.h).toBe(3);
    expect(p.hr).toBe(1);
    expect(p.doubles).toBe(1);
    expect(p.avg).toBeCloseTo(3 / 8, 6);
    // Total bases: singles=1, doubles=1, hr=1 → 1 + 2 + 4 = 7; SLG = 7/8
    expect(p.slg).toBeCloseTo(7 / 8, 6);
    // OBP: (3+1)/(8+1) = 4/9
    expect(p.obp).toBeCloseTo(4 / 9, 6);
  });

  it("does NOT have a PB field (softball-only)", () => {
    const result = aggregateBatting([battingLine("p1", { ab: 1, h: 1 })]);
    // @ts-expect-error — pb should not exist on BaseballBatterStats
    expect(result[0]?.pb).toBeUndefined();
  });
});

// =============================================================================
// Pitching
// =============================================================================

describe("baseball aggregatePitching", () => {
  it("empty input → empty output", () => {
    expect(aggregatePitching([])).toEqual([]);
  });

  it("9 IP, 3 ER → ERA = 3.00", () => {
    const result = aggregatePitching([
      pitchingLine("p1", { ip_outs: parseIP("9.0"), er: 3 }),
    ]);
    expect(result[0]?.era).toBeCloseTo(3.0, 6);
  });

  it("6.2 IP, 4 ER → ERA = 5.40 (NOT 5.806 from naive 6.2 float math)", () => {
    const result = aggregatePitching([
      pitchingLine("p1", { ip_outs: parseIP("6.2"), er: 4 }),
    ]);
    expect(result[0]?.era).toBeCloseTo(5.4, 2);
  });

  it("0 IP → ERA = 0 (not NaN or Infinity)", () => {
    const result = aggregatePitching([
      pitchingLine("p1", { ip_outs: 0, er: 0 }),
    ]);
    expect(result[0]?.era).toBe(0);
  });

  it("WHIP: 9 IP, 3 H, 1 BB → 4/9 ≈ 0.444", () => {
    const result = aggregatePitching([
      pitchingLine("p1", { ip_outs: parseIP("9.0"), h: 3, bb: 1 }),
    ]);
    expect(result[0]?.whip).toBeCloseTo(4 / 9, 6);
  });

  it("sums multiple appearances (relief or multi-game)", () => {
    const result = aggregatePitching([
      pitchingLine("p1", { ip_outs: parseIP("5.0"), h: 4, bb: 2, er: 2, so: 4 }),
      pitchingLine("p1", { ip_outs: parseIP("4.0"), h: 3, bb: 1, er: 1, so: 5 }),
    ]);
    const p = result[0]!;
    expect(p.app).toBe(2);
    expect(p.ip_outs).toBe(parseIP("9.0"));
    expect(p.h).toBe(7);
    expect(p.bb).toBe(3);
    expect(p.er).toBe(3);
    expect(p.so).toBe(9);
    expect(p.era).toBeCloseTo(3.0, 2); // (3 * 27) / 27 = 3.00
    expect(p.whip).toBeCloseTo(10 / 9, 4);
  });

  it("counts wins/losses/saves from decisions", () => {
    const result = aggregatePitching([
      pitchingLine("p1", { ip_outs: parseIP("5.0"), decision: "W" }),
      pitchingLine("p1", { ip_outs: parseIP("1.0"), decision: "S" }),
      pitchingLine("p1", { ip_outs: parseIP("4.0"), decision: "L" }),
      pitchingLine("p1", { ip_outs: parseIP("2.0") }), // no decision
    ]);
    const p = result[0]!;
    expect(p.app).toBe(4);
    expect(p.w).toBe(1);
    expect(p.l).toBe(1);
    expect(p.sv).toBe(1);
  });

  it("rejects non-integer or negative ip_outs (catches misuse of 6.2 as float)", () => {
    expect(() =>
      aggregatePitching([pitchingLine("p1", { ip_outs: 6.2 })]),
    ).toThrow(/integer/i);
    expect(() =>
      aggregatePitching([pitchingLine("p1", { ip_outs: -1 })]),
    ).toThrow(/integer/i);
  });

  it("uses ipFromInningsAndOuts ergonomically", () => {
    const result = aggregatePitching([
      pitchingLine("p1", { ip_outs: ipFromInningsAndOuts(7, 1), er: 2 }),
    ]);
    // 7.1 IP = 22 outs; ERA = (2 * 27) / 22 ≈ 2.4545
    expect(result[0]?.era).toBeCloseTo(2 * 27 / 22, 6);
  });
});

// =============================================================================
// Dirty-check helpers
// =============================================================================

describe("batterStatsAreEqual", () => {
  const base: BaseballBatterStats = {
    player_id: "p1", gp: 5,
    ab: 20, r: 4, h: 6, doubles: 2, triples: 0, hr: 1,
    rbi: 4, bb: 3, so: 5, sb: 1,
    avg: 0.3, slg: 0.55, obp: 0.391, ops: 0.941,
  };
  it("ignores derived diffs", () => {
    expect(batterStatsAreEqual(base, { ...base, avg: 0.999 })).toBe(true);
  });
  it("counts diff → not equal", () => {
    expect(batterStatsAreEqual(base, { ...base, hr: 2 })).toBe(false);
  });
});

describe("pitcherStatsAreEqual", () => {
  const base: BaseballPitcherStats = {
    player_id: "p1", app: 5, w: 2, l: 1, sv: 1,
    ip_outs: 81, h: 30, r: 12, er: 10, bb: 8, so: 25, hr: 2,
    era: 3.33, whip: 1.41,
  };
  it("ignores derived diffs", () => {
    expect(pitcherStatsAreEqual(base, { ...base, era: 99 })).toBe(true);
  });
  it("counts diff → not equal", () => {
    expect(pitcherStatsAreEqual(base, { ...base, ip_outs: 82 })).toBe(false);
    expect(pitcherStatsAreEqual(base, { ...base, w: 3 })).toBe(false);
  });
});
