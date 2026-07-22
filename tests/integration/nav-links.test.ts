// computeNavLinks — per-tenant nav shaping.
//
// Three things here have already broken once or come close, so they are pinned:
//
//  1. The league-info dropdown is labelled "SFBL" in DEFAULT_LINKS and
//     SFBL_ONLY_LABELS deletes anything still called "SFBL" for other tenants.
//     Before the relabel fix that quietly took Rules and Fields down with it on
//     every non-SFBL site.
//
//  2. "Captain" is also in SFBL_ONLY_LABELS, so a tenant that wants a captain
//     link must add it under a DIFFERENT label. Island uses "Coach Login".
//     Naming it "Captain" would silently delete the only route to the product.
//
//  3. A tenant-added entry may be a dropdown (Island's "Information"). The
//     layout's validator has to preserve `children`; a {label, href} filter
//     type-checks fine and flattens the menu to a dead "#".

import { describe, it, expect } from "vitest";
import {
  computeNavLinks,
  DEFAULT_LINKS,
  type NavLink,
} from "@/components/ui/nav-links";

const find = (links: NavLink[], label: string) =>
  links.find((l) => l.label === label);

describe("computeNavLinks — SFBL stays as authored", () => {
  const links = computeNavLinks(DEFAULT_LINKS, "SFBL");

  it("keeps its own league dropdown and Captain link", () => {
    expect(find(links, "SFBL")).toBeTruthy();
    const more = find(links, "More");
    expect(more?.children?.some((c) => c.label === "Captain")).toBe(true);
  });
});

describe("computeNavLinks — the SFBL-label trap", () => {
  it("relabels the league dropdown instead of deleting Rules and Fields", () => {
    const links = computeNavLinks(DEFAULT_LINKS, "IFP");
    expect(find(links, "SFBL")).toBeUndefined();
    const league = find(links, "IFP");
    expect(league).toBeTruthy();
    const kids = league?.children?.map((c) => c.label) ?? [];
    expect(kids).toContain("Rules");
    expect(kids).toContain("Fields");
  });

  it('drops a tenant link literally labelled "Captain"', () => {
    // Documents WHY Island's link is called "Coach Login".
    const links = computeNavLinks(DEFAULT_LINKS, "IFP");
    const more = find(links, "More");
    expect(more?.children?.some((c) => c.label === "Captain")).toBe(false);
  });
});

describe("computeNavLinks — Island's layout", () => {
  const HIDE = ["stats", "photos", "news", "playoffs", "info", "rules", "fields"];
  const ADD: NavLink[] = [
    { label: "Fields", href: "/fields" },
    { label: "Events & Clinics", href: "/content/events-clinics" },
    {
      label: "Information",
      href: "#",
      children: [
        { label: "Player Ads", href: "/player-ads" },
        { label: "Rules", href: "/rules" },
        { label: "Coach Login", href: "/captain" },
      ],
    },
  ];
  const links = computeNavLinks(DEFAULT_LINKS, "IFP", HIDE, ADD);
  const labels = links.map((l) => l.label);

  it("removes the league dropdown once all its children are hidden", () => {
    expect(labels).not.toContain("IFP");
    expect(labels).not.toContain("SFBL");
  });

  it("puts Fields back as its own top-level button", () => {
    expect(labels).toContain("Fields");
    expect(find(links, "Fields")?.href).toBe("/fields");
    expect(find(links, "Fields")?.children).toBeUndefined();
  });

  it("renders Information as a dropdown with the three items", () => {
    const info = find(links, "Information");
    expect(info?.children?.map((c) => c.label)).toEqual([
      "Player Ads",
      "Rules",
      "Coach Login",
    ]);
  });

  it("lets Coach Login survive because it is added AFTER the SFBL filter", () => {
    const info = find(links, "Information");
    const coach = info?.children?.find((c) => c.label === "Coach Login");
    expect(coach?.href).toBe("/captain");
  });

  it("keeps the core pages at top level", () => {
    for (const l of ["Home", "Scores", "Schedule", "Standings", "Teams"]) {
      expect(labels).toContain(l);
    }
    // Hidden for this tenant.
    expect(labels).not.toContain("Stats");
  });
});
