import { describe, expect, it } from "vitest";
import { looksLikeSpam, isGibberish } from "@/lib/spam";

describe("spam heuristic", () => {
  it("flags the real bot registration Nelson received", () => {
    expect(
      looksLikeSpam({
        first_name: "BFPXoiXJKFzeovzU",
        last_name: "eqITgOQrdiSFAEhtZgbT",
        email: "eren.kilic@web.de",
        phone: "2441669302",
        city: "Dwymtwyaq",
        primary_position: "C",
        secondary_position: "C",
        division: "18+",
      }),
    ).toBe(true);
  });

  it("does NOT flag real registrations (incl. SFBL-typical names)", () => {
    const real = [
      { first_name: "Carlos", last_name: "Rodriguez", city: "Miami", primary_position: "SS", secondary_position: "2B" },
      { first_name: "John", last_name: "Smith", city: "Hialeah", primary_position: "P", secondary_position: "1B" },
      { first_name: "Yasiel", last_name: "Hernandez", city: "Coral Springs", primary_position: "CF", secondary_position: "RF" },
      { first_name: "Xavier", last_name: "Nunez", city: "Fort Lauderdale", primary_position: "3B", secondary_position: "SS" },
      { first_name: "Jean-Luc", last_name: "Pierre", city: "Miramar", primary_position: "C", secondary_position: "1B" },
    ];
    for (const r of real) expect(looksLikeSpam(r)).toBe(false);
  });

  it("a single odd field alone is not enough to flag (needs corroboration)", () => {
    // One unusual name, everything else normal → below the threshold.
    expect(
      looksLikeSpam({
        first_name: "Zqxwvbn",
        last_name: "Johnson",
        city: "Miami",
        primary_position: "SS",
        secondary_position: "2B",
      }),
    ).toBe(false);
  });

  it("isGibberish catches random-case tokens + consonant soup, not real names", () => {
    expect(isGibberish("BFPXoiXJKFzeovzU")).toBe(true);
    expect(isGibberish("eqITgOQrdiSFAEhtZgbT")).toBe(true);
    expect(isGibberish("Dwymtwyaq")).toBe(true);
    expect(isGibberish("Rodriguez")).toBe(false);
    expect(isGibberish("Hernandez")).toBe(false);
    expect(isGibberish("Bob")).toBe(false);
  });
});
