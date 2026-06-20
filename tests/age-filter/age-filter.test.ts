import { describe, it, expect } from "vitest";
import { buildAgeFilter } from "@/lib/age-filter";

const teams = {
  t10a: { ageGroup: "10U" },
  t10b: { ageGroup: "10U" },
  t12a: { ageGroup: "12U" },
  t8a: { ageGroup: "8U" },
};

describe("buildAgeFilter", () => {
  it("lists distinct age groups youngest-first", () => {
    expect(buildAgeFilter(teams, undefined).groups).toEqual(["8U", "10U", "12U"]);
  });

  it("builds All + per-group pills with All active by default", () => {
    const r = buildAgeFilter(teams, undefined);
    expect(r.ageOptions.map((o) => o.label)).toEqual(["All ages", "8U", "10U", "12U"]);
    expect(r.ageOptions[0]?.active).toBe(true);
    expect(r.ageOptions.slice(1).every((o) => !o.active)).toBe(true);
    expect(r.selectedAge).toBeNull();
  });

  it("activates and validates the requested group", () => {
    const r = buildAgeFilter(teams, "10U");
    expect(r.selectedAge).toBe("10U");
    const active = r.ageOptions.filter((o) => o.active);
    expect(active).toHaveLength(1);
    expect(active[0]?.value).toBe("10U");
  });

  it("ignores an unknown requested group (falls back to all)", () => {
    const r = buildAgeFilter(teams, "99U");
    expect(r.selectedAge).toBeNull();
    expect(r.ageOptions[0]?.active).toBe(true);
  });

  it("resolves a game's age from the home team, then the away team", () => {
    const r = buildAgeFilter(teams, undefined);
    expect(r.ageOf("t10a", "t10b")).toBe("10U");
    expect(r.ageOf("unknown", "t12a")).toBe("12U"); // home unknown -> away
    expect(r.ageOf("unknown", "unknown")).toBeUndefined();
  });

  it("renders no pills for a flat league (one or zero age groups)", () => {
    // Single age group -> nothing to filter.
    expect(
      buildAgeFilter({ a: { ageGroup: "10U" }, b: { ageGroup: "10U" } }, undefined)
        .ageOptions,
    ).toEqual([]);
    // No ageGroup at all (SFBL) -> flat, unaffected.
    expect(buildAgeFilter({ a: {}, b: {} }, undefined).ageOptions).toEqual([]);
    expect(buildAgeFilter({}, undefined).groups).toEqual([]);
  });
});
