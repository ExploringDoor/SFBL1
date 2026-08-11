// What a coach actually gets charged.
//
// These are real charges to real people, and the surcharge half is a legal
// requirement in New York rather than a preference, so the numbers are pinned
// rather than left to whoever edits lib/square.ts next.

import { describe, expect, it } from "vitest";
import {
  chargeCents,
  feeFor,
  nyCompliantTotal,
  surchargeFor,
} from "@/lib/square";

const SQUARE_PCT = 0.029;
const SQUARE_FIXED = 0.3;

/** What Square keeps on a card charge of `totalDollars`. */
function squareTakes(totalDollars: number): number {
  return Math.round((totalDollars * SQUARE_PCT + SQUARE_FIXED) * 100) / 100;
}

describe("Island league fees", () => {
  it("charges $795 for weeknight, weekend and college", () => {
    for (const division of ["weeknight", "weekend", "sunday-night"]) {
      expect(feeFor("island", { age_group: "12U", division })).toBe(795);
    }
  });

  it("charges $500 for 8U, whatever the division", () => {
    expect(feeFor("island", { age_group: "8U", division: "weekend" })).toBe(500);
  });

  it("does NOT apply the $200 home-field discount — Mike adjusts by hand", () => {
    // Self-claiming at checkout gets claimed by teams that do not qualify, so
    // the discount deliberately never reaches the price the card is charged.
    expect(feeFor("island", { age_group: "12U", home_field: "yes" })).toBe(795);
  });

  it("falls back to the full fee when the age group is missing or odd", () => {
    expect(feeFor("island", {})).toBe(795);
    expect(feeFor("island", { age_group: "" })).toBe(795);
    // Never silently cheaper: "8" is not "8U".
    expect(feeFor("island", { age_group: "8" })).toBe(795);
  });
});

describe("COYBL fees are untouched by the Island work", () => {
  it("still reads insurance option and the USSSA add-on", () => {
    expect(feeFor("coybl", { insurance_option: "option-1" })).toBe(495);
    expect(feeFor("coybl", { insurance_option: "option-2" })).toBe(425);
    expect(
      feeFor("coybl", { insurance_option: "option-2", usssa_addon: "yes" }),
    ).toBe(475);
  });

  it("keeps Doug's flat 3.25% surcharge", () => {
    expect(chargeCents("coybl", 495)).toBe(51109);
  });

  it("does not read Island's fields", () => {
    // An age_group on a COYBL registration must not become an Island price.
    expect(feeFor("coybl", { age_group: "8U" })).toBe(495);
  });
});

describe("New York compliance — the surcharge cannot exceed real cost", () => {
  // NY GBL 518: passing the fee on is legal, over-collecting is not.
  for (const fee of [795, 500, 625, 650]) {
    it(`nets the league exactly $${fee} and no more`, () => {
      const total = nyCompliantTotal(fee);
      const netted = total - squareTakes(total);
      // Never MORE than the fee — over-collecting is the unlawful direction.
      expect(netted).toBeLessThanOrEqual(fee);
      // And never short by more than a cent of rounding.
      expect(netted).toBeGreaterThan(fee - 0.02);
    });

    it(`surcharge on $${fee} does not exceed what Square charges`, () => {
      const total = nyCompliantTotal(fee);
      const surcharge = Math.round((total - fee) * 100) / 100;
      expect(surcharge).toBeLessThanOrEqual(squareTakes(total));
    });
  }

  it("is well under the federal 4% cap", () => {
    const fee = 795;
    expect(surchargeFor("island", fee) / fee).toBeLessThan(0.04);
  });

  it("pins the headline number so a refactor cannot move it silently", () => {
    // $795 team fee -> $819.05 on a card. If this changes, the League page
    // copy and anything quoted to Mike has to change with it.
    expect(chargeCents("island", 795)).toBe(81905);
    expect(surchargeFor("island", 795)).toBeCloseTo(24.05, 2);
  });

  it("beats a flat 3.25%, which would over-collect and be unlawful here", () => {
    const flat = Math.round(795 * 1.0325 * 100);
    expect(chargeCents("island", 795)).toBeLessThan(flat);
  });
});
