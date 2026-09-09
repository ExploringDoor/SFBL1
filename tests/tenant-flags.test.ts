import { describe, expect, it } from "vitest";
import { boxScoreEnabled, statsEnabled } from "@/lib/tenant-flags";

// Pinned against each tenant's real flags block, read from its live config or
// its seed script. The Island coach portal sent every score button to the box
// score editor for the whole 2026 preseason because the only gate in the file
// named "coybl" by hand and nobody added the second slug. These cases exist so
// the next stats off league does not have to be added anywhere at all.
const FLAGS: Record<string, { stats_enabled?: boolean } | undefined> = {
  island: { stats_enabled: false },
  coybl: { stats_enabled: false },
  lcybl: { stats_enabled: false },
  windmill: { stats_enabled: false },
  helena: { stats_enabled: false },
  etbl: { stats_enabled: false },
  // Stats on. No stats_enabled key at all, which must read as "on".
  sfbl: undefined,
  lbdc: undefined,
};

describe("boxScoreEnabled", () => {
  for (const [slug, flags] of Object.entries(FLAGS)) {
    const on = flags?.stats_enabled !== false;
    it(`${slug}: box score ${on ? "on" : "off"}`, () => {
      expect(boxScoreEnabled({ flags })).toBe(on);
      expect(statsEnabled({ flags })).toBe(on);
    });
  }

  it("falls open when the tenant config never arrived", () => {
    // middleware drops the config header on its own failures. Losing Box Score
    // for SFBL because a header was missing would be a worse outcome than
    // showing it for a beat, so null must read as on.
    expect(boxScoreEnabled(null)).toBe(true);
    expect(boxScoreEnabled(undefined)).toBe(true);
    expect(boxScoreEnabled({})).toBe(true);
  });
});