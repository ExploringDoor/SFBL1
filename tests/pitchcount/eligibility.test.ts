import { describe, it, expect } from "vitest";
import { computeEligibility, restDaysFor } from "../../lib/pitchcount/eligibility";
import {
  COYBL_9U_10U,
  COYBL_11U_12U,
  COYBL_13U_14U,
  rulesetIdForAge,
} from "../../lib/pitchcount/rulesets";

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

  // Safety-critical: Pitch Smart rest is based on pitches thrown IN A DAY,
  // so two appearances on one day must be summed before the tier lookup.
  it("sums two outings on the SAME day (doubleheader / relief stint)", () => {
    const r = computeEligibility(
      [
        { date: "2026-06-09", pitches: 40 },
        { date: "2026-06-09", pitches: 40 },
      ],
      COYBL_9U_10U,
      "2026-06-11",
    );
    expect(r.pitchesLast).toBe(80); // not 40
    expect(r.restDaysRequired).toBe(4); // 80 → 66+ tier, not 40 → 2 days
    expect(r.nextEligibleDate).toBe("2026-06-14");
    expect(r.status).toBe("resting"); // would have been "eligible" pre-fix
  });

  it("an earlier heavy day still governs if its rest window is longer", () => {
    // Threw 70 on the 9th (4 rest → eligible 06-14), then — against the
    // rules — threw 10 on the 10th (0 rest → eligible 06-11). The longer
    // pending window must win, otherwise the pitcher is cleared early.
    const r = computeEligibility(
      [
        { date: "2026-06-09", pitches: 70 },
        { date: "2026-06-10", pitches: 10 },
      ],
      COYBL_9U_10U,
      "2026-06-11",
    );
    expect(r.nextEligibleDate).toBe("2026-06-14");
    expect(r.status).toBe("resting");
  });

  it("flags a day total over the age group's daily max", () => {
    const over = computeEligibility(
      [{ date: "2026-06-09", pitches: 90 }], // 10U cap is 75
      COYBL_9U_10U,
      "2026-06-09",
    );
    expect(over.dailyMaxExceeded).toBe(true);
    const under = computeEligibility(
      [{ date: "2026-06-09", pitches: 70 }],
      COYBL_9U_10U,
      "2026-06-09",
    );
    expect(under.dailyMaxExceeded).toBe(false);
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
  it("maps each kid-pitch age pair to its ruleset", () => {
    expect(rulesetIdForAge("9U")).toBe("9U-10U");
    expect(rulesetIdForAge("10U")).toBe("9U-10U");
    expect(rulesetIdForAge("11U")).toBe("11U-12U");
    expect(rulesetIdForAge("12U")).toBe("11U-12U");
    expect(rulesetIdForAge("13U")).toBe("13U-14U");
    expect(rulesetIdForAge("14U")).toBe("13U-14U");
  });
  it("returns null for coach-pitch ages (7U/8U)", () => {
    expect(rulesetIdForAge("7U")).toBeNull();
    expect(rulesetIdForAge("8U")).toBeNull();
  });
});

describe("rulesets — daily max differs, rest tiers identical", () => {
  it("has the documented per-age daily maxes", () => {
    expect(COYBL_9U_10U.dailyMax).toBe(75);
    expect(COYBL_11U_12U.dailyMax).toBe(85);
    expect(COYBL_13U_14U.dailyMax).toBe(95);
  });
  it("uses the same rest tiers across all ages", () => {
    for (const rs of [COYBL_9U_10U, COYBL_11U_12U, COYBL_13U_14U]) {
      expect(restDaysFor(20, rs)).toBe(0);
      expect(restDaysFor(35, rs)).toBe(1);
      expect(restDaysFor(50, rs)).toBe(2);
      expect(restDaysFor(65, rs)).toBe(3);
      expect(restDaysFor(66, rs)).toBe(4);
    }
  });
});
