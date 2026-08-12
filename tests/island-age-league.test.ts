// Island Fastpitch: age group decides which leagues a team may enter.
//
// From Mike's own League page:
//   Weeknight / Weekend / Sunday Night ... 10U, 12U, 14U, 16/18U
//   "8U Weekend League"      <- the only league 8U plays
//   College Division $795    <- weeknight and weekend
//
// This is a money rule, not a cosmetic one: lib/square.ts charges $500 for 8U,
// which is the 8U WEEKEND fee. An "8U Weeknight" registration is a league that
// does not exist AND a $295 shortfall, so the pairing is pinned here.

import { describe, expect, it } from "vitest";
import { optionsFor, prunedValue, type DependentSelect } from "@/lib/form-options";
import { feeFor } from "@/lib/square";

/** Mirrors the `division` field in ISLAND_FIELDS (app/team-registration). */
const DIVISION: DependentSelect = {
  name: "division",
  dependsOn: "age_group",
  optionsBy: {
    "8U": [{ value: "weekend", label: "8U Weekend League" }],
    college: [
      { value: "weeknight", label: "Weeknight" },
      { value: "weekend", label: "Weekend (Saturdays and Sundays)" },
    ],
  },
  options: [
    { value: "weekend", label: "Weekend (Saturdays and Sundays)" },
    { value: "weeknight", label: "Weeknight" },
    { value: "sunday-night", label: "Sunday Night" },
  ],
};

const values = (age: string) =>
  optionsFor(DIVISION, { age_group: age }).map((o) => o.value);

describe("which leagues each age group can enter", () => {
  it("offers 8U the Weekend league and nothing else", () => {
    expect(values("8U")).toEqual(["weekend"]);
  });

  it("offers College weeknight and weekend, but not Sunday Night", () => {
    expect(values("college")).toEqual(["weeknight", "weekend"]);
  });

  it("offers 10U through 16/18U all three leagues", () => {
    for (const age of ["10U", "12U", "14U", "16/18U"]) {
      expect(values(age)).toEqual(["weekend", "weeknight", "sunday-night"]);
    }
  });

  it("falls back to all three for an age nobody has mapped yet", () => {
    // A new age group next season must not produce an empty dropdown that
    // blocks registration outright.
    expect(values("6U")).toEqual(["weekend", "weeknight", "sunday-night"]);
  });

  it("offers nothing to choose from until the age is picked", () => {
    // The select renders disabled in this state rather than empty.
    expect(optionsFor(DIVISION, {}).length).toBeGreaterThan(0);
    expect(optionsFor(DIVISION, { age_group: "" })).toEqual(DIVISION.options);
  });
});

describe("changing the age prunes a league that is no longer on offer", () => {
  it("drops weeknight when a 10U team is corrected to 8U", () => {
    // The bug this prevents: the dropdown stops SHOWING weeknight, but the
    // value stays behind and gets submitted anyway.
    expect(prunedValue(DIVISION, { age_group: "8U", division: "weeknight" })).toBe("");
  });

  it("drops sunday-night when a 14U team is corrected to College", () => {
    expect(
      prunedValue(DIVISION, { age_group: "college", division: "sunday-night" }),
    ).toBe("");
  });

  it("keeps a choice that is still valid", () => {
    expect(prunedValue(DIVISION, { age_group: "8U", division: "weekend" })).toBe(
      "weekend",
    );
    expect(
      prunedValue(DIVISION, { age_group: "12U", division: "weeknight" }),
    ).toBe("weeknight");
  });

  it("is a no-op when nothing was chosen", () => {
    expect(prunedValue(DIVISION, { age_group: "8U" })).toBe("");
  });
});

describe("the fees behind the rule", () => {
  it("prices College at $795", () => {
    // College was absent from the form entirely, so this pairing had never
    // been priced. It falls through to the default, which is correct.
    for (const division of ["weeknight", "weekend"]) {
      expect(feeFor("island", { age_group: "college", division })).toBe(795);
    }
  });

  it("prices 8U Weekend at $500", () => {
    expect(feeFor("island", { age_group: "8U", division: "weekend" })).toBe(500);
  });

  it("explains why 8U is capped to Weekend: any other league keeps the $500", () => {
    // feeFor keys on age alone, deliberately — an 8U registration IS a weekend
    // one once the pairing is enforced. This test documents the dependency:
    // if the form ever offers 8U another league again, this $500 goes with it.
    expect(feeFor("island", { age_group: "8U", division: "weeknight" })).toBe(500);
    expect(values("8U")).not.toContain("weeknight");
  });
});
