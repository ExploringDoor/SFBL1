import { describe, expect, it } from "vitest";
import { feeFor, chargeCents, surchargeFor } from "@/lib/square";
import { optionsFor, prunedValue } from "@/lib/form-options";

const DIVISION = {
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
    { value: "weekend", label: "Weekend" },
    { value: "weeknight", label: "Weeknight" },
    { value: "sunday-night", label: "Sunday Night" },
  ],
};

const AGES = ["8U", "10U", "12U", "14U", "16/18U", "college"];

describe("EVERY age x league combination a coach can actually submit", () => {
  for (const age of AGES) {
    const allowed = optionsFor(DIVISION, { age_group: age }).map((o) => o.value);
    for (const div of allowed) {
      it(`${age} / ${div} prices and charges correctly`, () => {
        const fee = feeFor("island", { age_group: age, division: div });
        expect(fee).toBe(age === "8U" ? 500 : 795);
        const total = chargeCents("island", fee) / 100;
        // The league must net the fee exactly, never less.
        const squareTakes = Math.round((total * 0.029 + 0.3) * 100) / 100;
        expect(total - squareTakes).toBeGreaterThan(fee - 0.02);
        expect(total - squareTakes).toBeLessThanOrEqual(fee);
        // And the surcharge must never exceed Square's real cost (NY GBL 518).
        expect(Math.round((total - fee) * 100) / 100).toBeLessThanOrEqual(squareTakes);
      });
    }
  }

  it("8U can ONLY pick weekend", () => {
    expect(optionsFor(DIVISION, { age_group: "8U" }).map((o) => o.value)).toEqual(["weekend"]);
  });
  it("college cannot pick sunday-night", () => {
    expect(optionsFor(DIVISION, { age_group: "college" }).map((o) => o.value)).not.toContain("sunday-night");
  });
  it("every other age keeps all three", () => {
    for (const age of ["10U", "12U", "14U", "16/18U"]) {
      expect(optionsFor(DIVISION, { age_group: age })).toHaveLength(3);
    }
  });
});

describe("a coach changing their mind mid-form", () => {
  const flips: [string, string, string][] = [
    ["12U", "weeknight", "8U"],
    ["12U", "sunday-night", "college"],
    ["8U", "weekend", "12U"],
    ["college", "weeknight", "8U"],
  ];
  for (const [fromAge, div, toAge] of flips) {
    it(`${fromAge}+${div} -> ${toAge} never keeps an invalid league`, () => {
      const kept = prunedValue(DIVISION, { age_group: toAge, division: div });
      if (kept) {
        expect(optionsFor(DIVISION, { age_group: toAge }).map((o) => o.value)).toContain(kept);
      }
    });
  }
});

describe("no test-fee override is active", () => {
  it("a 12U team is $795, not $1", () => {
    expect(feeFor("island", { age_group: "12U" })).toBe(795);
  });
});

describe("headline numbers Mike may have quoted", () => {
  it("$795 -> $819.05 on a card", () => expect(chargeCents("island", 795)).toBe(81905));
  it("$500 -> $515.24 on a card", () => expect(chargeCents("island", 500)).toBe(51524));
  it("surcharges", () => {
    expect(surchargeFor("island", 795)).toBeCloseTo(24.05, 2);
    expect(surchargeFor("island", 500)).toBeCloseTo(15.24, 2);
  });
});
