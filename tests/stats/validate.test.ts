import { describe, expect, it } from "vitest";
import {
  battingLineError,
  collectLineupErrors,
} from "@/lib/stats/validate";

describe("battingLineError", () => {
  it("returns null for a consistent line", () => {
    expect(
      battingLineError({ h: 3, doubles: 1, triples: 0, hr: 1 }),
    ).toBeNull();
  });

  it("returns null when extra-base hits exactly equal hits", () => {
    // singles = 0 is fine; only NEGATIVE singles break sluggingPct.
    expect(battingLineError({ h: 2, doubles: 1, hr: 1 })).toBeNull();
  });

  it("flags H < 2B+3B+HR", () => {
    const err = battingLineError({ h: 1, doubles: 1, hr: 1 });
    expect(err).toMatch(/2B\+3B\+HR \(2\) exceeds H \(1\)/);
  });

  it("accepts d/t aliases for doubles/triples", () => {
    expect(battingLineError({ h: 1, d: 1, t: 1 })).toMatch(/exceeds H/);
  });

  it("coerces string values (CSV cells arrive as strings)", () => {
    expect(battingLineError({ h: "1", hr: "2" })).toMatch(/exceeds H/);
  });

  it("prefixes the label when provided", () => {
    expect(battingLineError({ h: 0, hr: 1 }, "Mays")).toMatch(/^Mays:/);
  });

  it("treats missing fields as 0 (empty line is valid)", () => {
    expect(battingLineError({})).toBeNull();
  });

  it("ignores non-finite numbers (coerced to 0)", () => {
    expect(battingLineError({ h: NaN, hr: NaN })).toBeNull();
  });
});

describe("collectLineupErrors", () => {
  it("returns [] for a clean lineup", () => {
    expect(collectLineupErrors([{ h: 2, doubles: 1 }])).toEqual([]);
  });

  it("returns [] for non-array / missing lineup", () => {
    expect(collectLineupErrors(undefined)).toEqual([]);
  });

  it("labels by name, then player_id, then 1-based position", () => {
    const errs = collectLineupErrors([
      { name: "Ruth", h: 0, hr: 1 },
      { player_id: "p2", h: 0, doubles: 1 },
      { h: 0, triples: 1 },
    ]);
    expect(errs).toHaveLength(3);
    expect(errs[0]).toMatch(/^Ruth:/);
    expect(errs[1]).toMatch(/^p2:/);
    expect(errs[2]).toMatch(/^batter 3:/);
  });

  it("only reports offending lines", () => {
    const errs = collectLineupErrors([
      { name: "Good", h: 3, doubles: 1 },
      { name: "Bad", h: 1, hr: 2 },
    ]);
    expect(errs).toHaveLength(1);
    expect(errs[0]).toMatch(/^Bad:/);
  });

  it("adds a side prefix when given", () => {
    const errs = collectLineupErrors([{ name: "Ruth", h: 0, hr: 1 }], "away");
    expect(errs[0]).toMatch(/^away Ruth:/);
  });
});
