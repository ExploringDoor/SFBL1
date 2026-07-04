import { describe, it, expect } from "vitest";
import { DEFAULT_LINKS, hoistPlayoffs, computeNavLinks } from "@/components/ui/nav-links";

// hoistPlayoffs promotes "Playoffs" out of the "More" dropdown to a
// top-level nav item once the bracket is published (site_config/
// playoffs.active). When inactive it must be a no-op. (Batch B, 2026-07)

const topHrefs = (links: typeof DEFAULT_LINKS) => links.map((l) => l.href);
const moreChildLabels = (links: typeof DEFAULT_LINKS) =>
  links.find((l) => l.label === "More")?.children?.map((c) => c.label) ?? [];

describe("hoistPlayoffs", () => {
  it("is a no-op when inactive — Playoffs stays under More", () => {
    const out = hoistPlayoffs(DEFAULT_LINKS, false);
    expect(out).toBe(DEFAULT_LINKS); // same ref, untouched
    expect(topHrefs(out)).not.toContain("/playoffs");
    expect(moreChildLabels(out)).toContain("Playoffs");
  });

  it("when active, promotes Playoffs to top-level, right after Standings", () => {
    const out = hoistPlayoffs(DEFAULT_LINKS, true);
    const hrefs = topHrefs(out);
    expect(hrefs).toContain("/playoffs");
    // immediately after /standings
    expect(hrefs[hrefs.indexOf("/standings") + 1]).toBe("/playoffs");
    // and no longer buried in More
    expect(moreChildLabels(out)).not.toContain("Playoffs");
  });

  it("moves (not duplicates) — exactly one Playoffs entry after hoisting", () => {
    const out = hoistPlayoffs(DEFAULT_LINKS, true);
    const count = JSON.stringify(out).match(/"\/playoffs"/g)?.length ?? 0;
    expect(count).toBe(1);
  });

  it("does not mutate the input array", () => {
    const before = JSON.stringify(DEFAULT_LINKS);
    hoistPlayoffs(DEFAULT_LINKS, true);
    expect(JSON.stringify(DEFAULT_LINKS)).toBe(before);
  });

  it("composes with computeNavLinks so a hidden Playoffs stays hidden", () => {
    const hoisted = hoistPlayoffs(DEFAULT_LINKS, true);
    const out = computeNavLinks(hoisted, "SFBL", ["playoffs"]);
    expect(topHrefs(out)).not.toContain("/playoffs");
  });
});
