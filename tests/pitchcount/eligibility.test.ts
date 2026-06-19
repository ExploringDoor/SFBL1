import { describe, it, expect } from "vitest";
import { computeEligibility, restDaysFor } from "../../lib/pitchcount/eligibility";
import { COYBL_9U_10U, rulesetIdForAge } from "../../lib/pitchcount/rulesets";

describe("restDaysFor — 9U–10U tiers", () => {
  const cases: Array<[number, number]> = [
    [0, 0],
    [1, 0],
    [20, 0],
    [21, 1],
    [35, 1],
    [36, 2],
    [50, 2],
    [51, 3],
    [65, 3],
    [66, 4],
    [75, 4],
    [120, 4], // above daily max still maps to the top tier
  ];
  for (const [pitches, rest] of cases) {
    it(`${pitches} pitches → ${rest} rest days`, () => {
      expect(restDaysFor(pitches, COYBL_9U_10U)).toBe(rest);
    });
  }
});

describe("computeEligibility", () => {
  it("never pitched → eligible, no next-eligible date", () => {
    const r = computeEligibility([], COYBL_9U_10U, "2026-06-10");
    expect(r.status).toBe("eligible");
    expect(r.nextEligibleDate).toBeNull();
  });

  it("13 pitches (0 rest) → eligible the next day", () => {
    const r = computeEligibility(
      [{ date: "2026-06-09", pitches: 13 }],
      COYBL_9U_10U,
      "2026-06-10",
    );
    expect(r.restDaysRequired).toBe(0);
    expect(r.nextEligibleDate).toBe("2026-06-10");
    expect(r.status).toBe("eligible");
  });

  it("66 pitches (4 rest) → resting until +5 days", () => {
    const r = computeEligibility(
      [{ date: "2026-06-09", pitches: 66 }],
      COYBL_9U_10U,
      "2026-06-10",
    );
    expect(r.restDaysRequired).toBe(4);
    expect(r.nextEligibleDate).toBe("2026-06-14");
    expect(r.status).toBe("resting");
  });

  it("eligible exactly on the next-eligible date", () => {
    const r = computeEligibility(
      [{ date: "2026-06-09", pitches: 40 }], // 2 rest → next eligible 06-12
      COYBL_9U_10U,
      "2026-06-12",
    );
    expect(r.nextEligibleDate).toBe("2026-06-12");
    expect(r.status).toBe("eligible");
  });

  it("governed by the most recent outing, not an older heavy one", () => {
    const r = computeEligibility(
      [
        { date: "2026-06-01", pitches: 70 },
        { date: "2026-06-09", pitches: 15 },
      ],
      COYBL_9U_10U,
      "2026-06-10",
    );
    expect(r.pitchesLast).toBe(15);
    expect(r.status).toBe("eligible");
  });

  it("handles full-timestamp outing dates (day-only math)", () => {
    const r = computeEligibility(
      [{ date: "2026-06-09T18:30:00-04:00", pitches: 30 }], // 1 rest → 06-11
      COYBL_9U_10U,
      "2026-06-10",
    );
    expect(r.nextEligibleDate).toBe("2026-06-11");
    expect(r.status).toBe("resting");
  });
});

describe("rulesetIdForAge", () => {
  it("maps 9U and 10U to the shared ruleset", () => {
    expect(rulesetIdForAge("9U")).toBe("9U-10U");
    expect(rulesetIdForAge("10U")).toBe("9U-10U");
  });
  it("returns null for ages without a ruleset yet", () => {
    expect(rulesetIdForAge("12U")).toBeNull();
    expect(rulesetIdForAge("7U")).toBeNull();
  });
});
