import { describe, it, expect } from "vitest";
import { statsEnabled } from "@/lib/tenant-flags";

describe("statsEnabled", () => {
  it("defaults ON when unset — existing tenants (SFBL) are unaffected", () => {
    expect(statsEnabled(null)).toBe(true);
    expect(statsEnabled(undefined)).toBe(true);
    expect(statsEnabled({})).toBe(true);
    expect(statsEnabled({ flags: {} })).toBe(true);
    expect(statsEnabled({ flags: { show_tournaments: true } })).toBe(true);
  });

  it("is OFF only when explicitly false (COYBL)", () => {
    expect(statsEnabled({ flags: { stats_enabled: false } })).toBe(false);
  });

  it("is ON when explicitly true", () => {
    expect(statsEnabled({ flags: { stats_enabled: true } })).toBe(true);
  });
});
