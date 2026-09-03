// The scope table itself. Pure, so no emulator.
//
// The rules tests cover what a scoped session can read; this covers the
// decision that produces those claims in the first place, and in particular
// that a malformed or unknown claim grants NOTHING rather than defaulting open.

import { describe, it, expect } from "vitest";
import {
  accessFromClaim,
  hasScope,
  scopedTabKeys,
  ADMIN_ROLES,
} from "@/lib/admin-roles";

describe("accessFromClaim", () => {
  it("'admin' is unrestricted", () => {
    const a = accessFromClaim("admin");
    expect(a.full).toBe(true);
    expect(a.roleId).toBeNull();
    expect(a.scopes.has("umpires")).toBe(true);
    expect(a.scopes.has("broadcast")).toBe(true);
  });

  it("a known role gets exactly its declared scopes", () => {
    const a = accessFromClaim("admin:umpires");
    expect(a.full).toBe(false);
    expect(a.roleId).toBe("umpires");
    expect([...a.scopes]).toEqual(["umpires"]);
  });

  it("the scheduler gets the six it needs and nothing more", () => {
    const a = accessFromClaim("admin:scheduler");
    expect([...a.scopes].sort()).toEqual(
      [
        "broadcast",
        "schedule",
        "schedule-gen",
        "score-disputes",
        "scores",
        "teams",
      ].sort(),
    );
    // The umpire roster carries officials' phone numbers and the dates they
    // cannot work. Adding "teams" for rosters must not have leaked this in.
    expect(a.scopes.has("umpires")).toBe(false);
  });

  it("the umpire role did NOT gain teams when the scheduler did", () => {
    expect(accessFromClaim("admin:umpires").scopes.has("teams")).toBe(false);
  });

  it.each([
    ["admin:not-a-real-role", "unknown role id"],
    ["captain:team_a", "a captain claim"],
    ["player:p1", "a player claim"],
    ["", "empty string"],
    ["Admin", "wrong case"],
    ["adminx", "prefix lookalike"],
    [null, "null"],
    [undefined, "undefined"],
    [{ role: "admin" }, "an object"],
  ])("%s grants nothing (%s)", (claim, _why) => {
    const a = accessFromClaim(claim);
    expect(a.full).toBe(false);
    expect(a.scopes.size).toBe(0);
  });
});

describe("hasScope", () => {
  const tok = (v: unknown) => ({ leagues: { island: v } });

  it("a full admin passes every scope", () => {
    for (const s of ["umpires", "scores", "broadcast"] as const) {
      expect(hasScope(tok("admin"), "island", s)).toBe(true);
    }
  });

  it("a scoped role passes only its own", () => {
    expect(hasScope(tok("admin:umpires"), "island", "umpires")).toBe(true);
    expect(hasScope(tok("admin:umpires"), "island", "broadcast")).toBe(false);
  });

  it("a claim for another league does not carry over", () => {
    expect(
      hasScope({ leagues: { coybl: "admin" } }, "island", "scores"),
    ).toBe(false);
  });

  it("no token at all is refused", () => {
    expect(hasScope(null, "island", "scores")).toBe(false);
    expect(hasScope(undefined, "island", "scores")).toBe(false);
    expect(hasScope({}, "island", "scores")).toBe(false);
  });
});

describe("scopedTabKeys", () => {
  it("returns null for a full admin, meaning do not filter", () => {
    expect(scopedTabKeys(accessFromClaim("admin"))).toBeNull();
  });

  it("returns just the role's tabs otherwise", () => {
    const keys = scopedTabKeys(accessFromClaim("admin:umpires"));
    expect(keys && [...keys]).toEqual(["umpires"]);
  });
});

describe("the role table", () => {
  it("every declared scope is one the code knows", () => {
    const known = new Set([
      "umpires",
      "scores",
      "schedule",
      "schedule-gen",
      "score-disputes",
      "broadcast",
      "teams",
    ]);
    for (const [id, role] of Object.entries(ADMIN_ROLES)) {
      for (const s of role.scopes) {
        expect(known.has(s), `${id} declares unknown scope ${s}`).toBe(true);
      }
    }
  });
});
