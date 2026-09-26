import { describe, it, expect } from "vitest";
import { publicUmpires } from "@/lib/umpire-display";

// The games doc is world-readable, so the umpire EMAIL must never survive into
// anything a public page receives. This is the projection that guarantees it.
describe("publicUmpires", () => {
  it("keeps name + position but DROPS email", () => {
    const out = publicUmpires([
      { name: "Smith, John", email: "jsmith@umps.org", position: "Plate" },
      { name: "Doe, Jane", email: "jdoe@umps.org" },
    ]);
    expect(out).toEqual([
      { name: "Smith, John", position: "Plate" },
      { name: "Doe, Jane" },
    ]);
    // Explicitly assert no email key leaks through on any entry.
    for (const u of out) expect("email" in u).toBe(false);
  });

  it("skips entries with no usable name and tolerates junk", () => {
    expect(publicUmpires([{ email: "x@y.com" }, { name: "  " }, null, 3, "str"])).toEqual([]);
  });

  it("returns [] for a non-array (missing field)", () => {
    expect(publicUmpires(undefined)).toEqual([]);
    expect(publicUmpires(null)).toEqual([]);
    expect(publicUmpires({})).toEqual([]);
  });
});
