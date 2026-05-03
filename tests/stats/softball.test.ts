import { describe, expect, it } from "vitest";
import {
  aggregateBatting,
  statsAreEqual,
  type SoftballBattingLine,
  type SoftballPlayerStats,
} from "@/lib/stats/softball";

const line = (
  player_id: string,
  overrides: Partial<SoftballBattingLine> = {},
): SoftballBattingLine => ({
  player_id,
  ab: 0, r: 0, h: 0, doubles: 0, triples: 0, hr: 0,
  rbi: 0, bb: 0, so: 0,
  ...overrides,
});

describe("aggregateBatting", () => {
  it("empty input → empty output", () => {
    expect(aggregateBatting([])).toEqual([]);
  });

  it("one line → one player with derived stats computed", () => {
    const result = aggregateBatting([
      line("p1", { ab: 4, h: 2, doubles: 1, rbi: 1, bb: 1 }),
    ]);
    expect(result).toHaveLength(1);
    const p = result[0]!;
    expect(p.player_id).toBe("p1");
    expect(p.gp).toBe(1);
    expect(p.h).toBe(2);
    expect(p.avg).toBeCloseTo(0.5, 6);
    // SLG: singles=1, doubles=1; total bases = 1 + 2 = 3; SLG = 3/4 = .750
    expect(p.slg).toBeCloseTo(0.75, 6);
    // OBP: (h+bb)/(ab+bb) = (2+1)/(4+1) = 3/5 = .600
    expect(p.obp).toBeCloseTo(0.6, 6);
    // OPS = OBP + SLG = 1.350
    expect(p.ops).toBeCloseTo(1.35, 6);
  });

  it("multiple games for one player → counts sum, derived recomputed on totals", () => {
    const result = aggregateBatting([
      line("p1", { ab: 4, h: 2 }),
      line("p1", { ab: 4, h: 1 }),
      line("p1", { ab: 4, h: 0 }),
    ]);
    expect(result).toHaveLength(1);
    const p = result[0]!;
    expect(p.gp).toBe(3);
    expect(p.ab).toBe(12);
    expect(p.h).toBe(3);
    expect(p.avg).toBeCloseTo(0.25, 6);
  });

  it("multiple players → multiple stats lines", () => {
    const result = aggregateBatting([
      line("p1", { ab: 4, h: 2 }),
      line("p2", { ab: 3, h: 1 }),
    ]);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.player_id).sort()).toEqual(["p1", "p2"]);
  });

  it("zero AB across all games → AVG = 0 (no NaN)", () => {
    const result = aggregateBatting([
      line("p1", { ab: 0, bb: 1 }),
    ]);
    expect(result[0]?.avg).toBe(0);
    expect(result[0]?.slg).toBe(0);
    // OBP = 1/1 = 1.000 because (0+1) / (0+1)
    expect(result[0]?.obp).toBe(1);
  });

  it("PB column (softball-specific) is summed", () => {
    const result = aggregateBatting([
      line("p1", { ab: 1, pb: 2 }),
      line("p1", { ab: 1, pb: 1 }),
    ]);
    expect(result[0]?.pb).toBe(3);
  });

  it("PB defaults to 0 when omitted", () => {
    const result = aggregateBatting([line("p1", { ab: 1 })]);
    expect(result[0]?.pb).toBe(0);
  });

  it("SB column is summed", () => {
    const result = aggregateBatting([
      line("p1", { ab: 1, sb: 2 }),
      line("p1", { ab: 1, sb: 1 }),
    ]);
    expect(result[0]?.sb).toBe(3);
  });

  it("does NOT compute per-game derived stats first then average them", () => {
    // Sanity: 2 H in 5 AB then 0 H in 5 AB should be .200 season avg,
    // not the average-of-averages (.200 + .000) / 2 = .100.
    const result = aggregateBatting([
      line("p1", { ab: 5, h: 2 }),
      line("p1", { ab: 5, h: 0 }),
    ]);
    expect(result[0]?.avg).toBeCloseTo(0.2, 6);
  });

  it("propagates sluggingPct error on bad data", () => {
    expect(() =>
      aggregateBatting([
        // h=1 but doubles+triples+hr=2 → singles negative → throws
        line("p1", { ab: 4, h: 1, doubles: 1, triples: 1 }),
      ]),
    ).toThrow(/inconsistent/i);
  });
});

describe("statsAreEqual (dirty-check helper)", () => {
  const base: SoftballPlayerStats = {
    player_id: "p1",
    gp: 5, ab: 20, r: 4, h: 6, doubles: 2, triples: 0, hr: 1,
    rbi: 4, bb: 3, so: 5, sb: 1, pb: 0,
    avg: 0.3, slg: 0.55, obp: 0.391, ops: 0.941,
  };

  it("same counting stats → equal (derived stats ignored)", () => {
    const other = { ...base, avg: 0.999 }; // derived diff doesn't matter
    expect(statsAreEqual(base, other)).toBe(true);
  });

  it("different counting stat → not equal", () => {
    expect(statsAreEqual(base, { ...base, h: 7 })).toBe(false);
    expect(statsAreEqual(base, { ...base, gp: 6 })).toBe(false);
    expect(statsAreEqual(base, { ...base, pb: 1 })).toBe(false);
  });

  it("different player_id → not equal", () => {
    expect(statsAreEqual(base, { ...base, player_id: "p2" })).toBe(false);
  });
});
