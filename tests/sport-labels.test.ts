import { describe, expect, it } from "vitest";
import {
  scoreLabels,
  scoreUnit,
  sportNoun,
  venueLabels,
} from "@/lib/sport-labels";

// The standings table, the scores summary, the fields page and the meta
// description all read sport-aware words from lib/sport-labels. These pin the
// two things that matter: basketball gets basketball words, and every other
// input — including a missing config — gets exactly what the pages said
// before the helper existed.

describe("scoreLabels", () => {
  it("basketball scores points for / against", () => {
    expect(scoreLabels("basketball")).toEqual({
      for: "PF",
      against: "PA",
      diff: "DIFF",
    });
  });

  it("baseball, softball, unknown and missing all keep RS / RA", () => {
    const rs = { for: "RS", against: "RA", diff: "DIFF" };
    expect(scoreLabels("baseball")).toEqual(rs);
    expect(scoreLabels("softball")).toEqual(rs);
    expect(scoreLabels("cricket")).toEqual(rs);
    expect(scoreLabels(undefined)).toEqual(rs);
    expect(scoreLabels(null)).toEqual(rs);
  });
});

describe("scoreUnit", () => {
  it("points for basketball, runs for everything else", () => {
    expect(scoreUnit("basketball")).toBe("points");
    expect(scoreUnit("baseball")).toBe("runs");
    expect(scoreUnit("softball")).toBe("runs");
    expect(scoreUnit(undefined)).toBe("runs");
  });
});

describe("sportNoun", () => {
  it("names the sport, falling back to baseball as the layout always did", () => {
    expect(sportNoun("softball")).toBe("softball");
    expect(sportNoun("basketball")).toBe("basketball");
    expect(sportNoun("baseball")).toBe("baseball");
    expect(sportNoun("cricket")).toBe("baseball");
    expect(sportNoun(undefined)).toBe("baseball");
  });
});

describe("venueLabels", () => {
  it("basketball plays in gyms", () => {
    const v = venueLabels("basketball");
    expect(v.singular).toBe("Gym");
    expect(v.plural).toBe("Gyms");
    expect(v.blurb).toMatch(/gym/i);
    expect(v.blurb).not.toMatch(/diamond/i);
  });

  it("everyone else plays on fields, with the original diamond sentence", () => {
    for (const sport of ["baseball", "softball", undefined, null]) {
      const v = venueLabels(sport);
      expect(v.singular).toBe("Field");
      expect(v.plural).toBe("Fields");
      expect(v.blurb).toBe(
        "Every diamond the league plays at on one interactive map. Search the list or tap a pin for one-tap driving directions.",
      );
    }
  });
});
