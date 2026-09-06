// What each scoped password opens.
//
// This file exists because the roles are the one place where widening access
// is a one-word change. Adding "fields" to the scheduler on 2026-09-06 was a
// single line, and a single line in the wrong array would have handed the
// assistant the Payments tab.

import { describe, expect, it } from "vitest";
import {
  ADMIN_ROLES,
  accessFromClaim,
  hasScope,
  scopedTabKeys,
} from "@/lib/admin-roles";

const claim = (leagues: Record<string, string>, scopes?: string[]) => ({
  leagues,
  ...(scopes ? { admin_scopes: scopes } : {}),
});

describe("the assistant (scheduler)", () => {
  const tok = claim({ island: "admin:scheduler" });

  it("can manage fields, which Mike asked for on 2026-09-06", () => {
    expect(hasScope(tok, "island", "fields")).toBe(true);
  });

  it("keeps the scheduling scopes it already had", () => {
    for (const s of ["scores", "schedule", "schedule-gen", "teams", "broadcast"] as const) {
      expect(hasScope(tok, "island", s)).toBe(true);
    }
  });

  it("still cannot reach the umpire roster, which carries officials' numbers", () => {
    expect(hasScope(tok, "island", "umpires")).toBe(false);
  });

  it("opens no tab that is not a declared scope", () => {
    const tabs = scopedTabKeys(accessFromClaim("admin:scheduler"))!;
    for (const forbidden of ["payments", "captains", "forms", "branding", "audit"]) {
      expect(tabs.has(forbidden)).toBe(false);
    }
  });
});

describe("the umpire in chief", () => {
  const tok = claim({ island: "admin:umpires" });

  it("did NOT get fields as a side effect", () => {
    expect(hasScope(tok, "island", "fields")).toBe(false);
  });

  it("still opens only the umpire roster", () => {
    expect(scopedTabKeys(accessFromClaim("admin:umpires"))).toEqual(new Set(["umpires"]));
  });
});

describe("the full admin is unaffected", () => {
  it("holds every scope, including new ones, without being listed", () => {
    const tok = claim({ island: "admin" });
    for (const s of ["fields", "umpires", "teams", "scores"] as const) {
      expect(hasScope(tok, "island", s)).toBe(true);
    }
    // null means "no filtering", so a tab added later shows up for the owner
    // without anyone remembering this file.
    expect(scopedTabKeys(accessFromClaim("admin"))).toBeNull();
  });
});

describe("nothing else gets in", () => {
  it("a claim for another league grants nothing here", () => {
    expect(hasScope(claim({ coybl: "admin" }), "island", "fields")).toBe(false);
    expect(hasScope(claim({ coybl: "admin:scheduler" }), "island", "fields")).toBe(false);
  });

  it("an unknown role id grants nothing", () => {
    expect(hasScope(claim({ island: "admin:not-a-role" }), "island", "fields")).toBe(false);
  });

  it("a captain claim is not an admin claim", () => {
    expect(hasScope(claim({ island: "captain" }), "island", "fields")).toBe(false);
    expect(accessFromClaim("captain").full).toBe(false);
  });

  it("every role's scopes are real scopes, not typos", () => {
    // A typo here fails open in the worst way: the tab shows and the API says
    // no, or worse the reverse.
    const known = new Set(["umpires","scores","schedule","schedule-gen","score-disputes","broadcast","teams","fields"]);
    for (const [id, role] of Object.entries(ADMIN_ROLES)) {
      for (const s of role.scopes) {
        expect(known.has(s), `${id} declares unknown scope "${s}"`).toBe(true);
      }
    }
  });
});
