// What each scoped password opens.
//
// This file exists because the roles are the one place where widening access
// is a one-word change. Adding "fields" to the scheduler on 2026-09-06 was a
// single line, and a single line in the wrong array would have handed the
// assistant the Payments tab.

import { describe, expect, it } from "vitest";
import {
  ADMIN_ROLES,
  ALL_SCOPES,
  TOWN_SCOPES,
  accessFor,
  accessFromClaim,
  hasScope,
  resolveConfiguredRole,
  scopedTabKeys,
  teamInTown,
  townKey,
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

  it("can edit the rulebook, which Mike asked for the same day", () => {
    expect(hasScope(tok, "island", "rules")).toBe(true);
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

  it("did NOT get the rulebook either", () => {
    // Widening one role must never widen another. The umpire declares no
    // "rules" scope, so granting the assistant it changes nothing here.
    expect(hasScope(tok, "island", "rules")).toBe(false);
  });

  it("still opens only the umpire roster", () => {
    expect(scopedTabKeys(accessFromClaim("admin:umpires"))).toEqual(new Set(["umpires"]));
  });
});

describe("the full admin is unaffected", () => {
  it("holds every scope, including new ones, without being listed", () => {
    const tok = claim({ island: "admin" });
    for (const s of ["fields", "umpires", "teams", "scores", "rules"] as const) {
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
    // Derived from the source, not retyped. A hand-kept copy here just
    // failed for the third scope added this week, which is a test that
    // reports its own staleness rather than a real problem.
    const known = new Set<string>(ALL_SCOPES);
    for (const [id, role] of Object.entries(ADMIN_ROLES)) {
      for (const s of role.scopes) {
        expect(known.has(s), `${id} declares unknown scope "${s}"`).toBe(true);
      }
    }
    for (const s of TOWN_SCOPES) {
      expect(known.has(s), `TOWN_SCOPES declares unknown scope "${s}"`).toBe(true);
    }
  });
});

// ── ETBL: town commissioners (config-defined roles) ─────────────────────
//
// Seven towns, seven passwords, each entering scores for its own games. None
// of these roles is in ADMIN_ROLES; the league doc declares them and the mint
// route expands them into the token. These pin that a town can only narrow.

const mineola = {
  leagues: { etbl: "admin:mineola" },
  admin_role: "mineola",
  admin_scopes: ["scores", "volunteers"],
  admin_town: "Mineola",
};

describe("a town commissioner (config-defined role)", () => {
  it("enters scores and posts volunteer shifts, and nothing else", () => {
    expect(hasScope(mineola, "etbl", "scores")).toBe(true);
    expect(hasScope(mineola, "etbl", "volunteers")).toBe(true);
    for (const s of ["schedule", "teams", "umpires", "rules", "fields", "broadcast"] as const) {
      expect(hasScope(mineola, "etbl", s)).toBe(false);
    }
  });

  it("carries its town, and opens exactly its scoped tabs", () => {
    const a = accessFor(mineola, "etbl");
    expect(a.full).toBe(false);
    expect(a.roleId).toBe("mineola");
    expect(a.town).toBe("Mineola");
    expect(scopedTabKeys(a)).toEqual(new Set(["scores", "volunteers"]));
  });

  it("cannot widen itself past the town allowlist, whatever the token says", () => {
    const greedy = { ...mineola, admin_scopes: ["scores", "schedule", "teams", "rules"] };
    const a = accessFor(greedy, "etbl");
    expect([...a.scopes]).toEqual(["scores"]);
    expect(hasScope(greedy, "etbl", "teams")).toBe(false);
  });

  it("is only honoured when admin_role names the claimed role", () => {
    // Scopes minted for Quitman's password must not be readable as Mineola's.
    const swapped = { ...mineola, admin_role: "quitman" };
    expect(accessFor(swapped, "etbl").scopes.size).toBe(0);
    expect(hasScope(swapped, "etbl", "scores")).toBe(false);
  });

  it("drops unknown scope strings, and grants nothing for an all-unknown list", () => {
    const typo = { ...mineola, admin_scopes: ["scores", "payments", "everything"] };
    expect([...accessFor(typo, "etbl").scopes]).toEqual(["scores"]);
    const junk = { ...mineola, admin_scopes: ["payments"] };
    expect(accessFor(junk, "etbl").scopes.size).toBe(0);
  });

  it("without a town is still a config role, with exactly its declared scopes", () => {
    const { admin_town: _t, ...noTown } = mineola;
    const a = accessFor(noTown, "etbl");
    expect(a.town).toBeNull();
    expect([...a.scopes]).toEqual(["scores", "volunteers"]);
  });

  it("does not exist for a league claim that names no admin_role at all", () => {
    expect(accessFromClaim("admin:mineola").scopes.size).toBe(0);
    expect(accessFromClaim("admin:mineola", { admin_scopes: ["scores"] }).scopes.size).toBe(0);
  });
});

describe("the table roles are unchanged by the token", () => {
  it("a static role ignores admin_scopes in the token", () => {
    const tok = { leagues: { island: "admin:umpires" }, admin_role: "umpires", admin_scopes: ["scores"] };
    expect([...accessFor(tok, "island").scopes]).toEqual(["umpires"]);
    expect(hasScope(tok, "island", "scores")).toBe(false);
  });

  it("a static role can be town-narrowed but never widened", () => {
    const tok = { leagues: { island: "admin:scheduler" }, admin_town: "Bay Shore" };
    const a = accessFor(tok, "island");
    expect(a.town).toBe("Bay Shore");
    expect([...a.scopes]).toEqual(["scores"]);
  });

  it("the full admin ignores admin_town", () => {
    const tok = { leagues: { etbl: "admin" }, admin_town: "Mineola" };
    const a = accessFor(tok, "etbl");
    expect(a.full).toBe(true);
    expect(a.town).toBeNull();
    expect(a.scopes.size).toBe(ALL_SCOPES.length);
  });
});

describe("resolveConfiguredRole", () => {
  it("resolves a valid town role", () => {
    expect(
      resolveConfiguredRole("mineola", { password: "x", scopes: ["scores"], town: "Mineola" }),
    ).toEqual({ scopes: ["scores"], town: "Mineola" });
  });

  it("refuses ids the rules regex would not recognise", () => {
    for (const bad of ["Mineola", "mineola2", "big_sandy", "", "-x", "a".repeat(33)]) {
      expect(resolveConfiguredRole(bad, { scopes: ["scores"] }), bad).toBeNull();
    }
  });

  it("every accepted id also matches the rules regex once prefixed", () => {
    for (const ok of ["mineola", "big-sandy", "x", "quitman"]) {
      expect(resolveConfiguredRole(ok, { scopes: ["scores"] })).not.toBeNull();
      expect(`admin:${ok}`).toMatch(/^admin:[a-z-]+$/);
    }
  });

  it("an unknown id with no usable scopes is unmintable", () => {
    expect(resolveConfiguredRole("mineola", { password: "x" })).toBeNull();
    expect(resolveConfiguredRole("mineola", { scopes: [] })).toBeNull();
    expect(resolveConfiguredRole("mineola", { scopes: ["payments"] })).toBeNull();
    expect(resolveConfiguredRole("mineola", { scopes: "scores" })).toBeNull();
  });

  it("a table id takes the table's scopes and ignores cfg.scopes", () => {
    const r = resolveConfiguredRole("umpires", { password: "x", scopes: ["scores"] });
    expect(r).toEqual({ scopes: ["umpires"], town: null });
  });

  it("a town narrows a table role too, and never past TOWN_SCOPES", () => {
    const r = resolveConfiguredRole("scheduler", { town: "Bay Shore" });
    expect(r?.town).toBe("Bay Shore");
    expect(r?.scopes).toEqual(["scores"]);
    // A town on a role with nothing town-scoped leaves nothing to mint.
    expect(resolveConfiguredRole("umpires", { town: "Bay Shore" })).toBeNull();
  });

  it("trims the town and refuses one that is present but unusable", () => {
    expect(resolveConfiguredRole("mineola", { scopes: ["scores"], town: "  Mineola " })?.town).toBe(
      "Mineola",
    );
    expect(resolveConfiguredRole("mineola", { scopes: ["scores"], town: "x".repeat(61) })).toBeNull();
    expect(resolveConfiguredRole("mineola", { scopes: ["scores"], town: 42 })).toBeNull();
    // Absent / null / "" mean "no town", which is a legal config role.
    expect(resolveConfiguredRole("mineola", { scopes: ["scores"], town: "" })?.town).toBeNull();
  });
});

describe("townKey / teamInTown", () => {
  it("compares towns case- and whitespace-insensitively", () => {
    expect(townKey(" Mineola ")).toBe("mineola");
    expect(townKey("MINEOLA")).toBe("mineola");
    expect(townKey(null)).toBe("");
    expect(townKey(undefined)).toBe("");
    expect(teamInTown("  mineola ", "Mineola")).toBe(true);
    expect(teamInTown("Quitman", "Mineola")).toBe(false);
  });

  it("a team nobody assigned belongs to nobody", () => {
    expect(teamInTown(null, "Mineola")).toBe(false);
    expect(teamInTown("", "Mineola")).toBe(false);
    expect(teamInTown("", "")).toBe(false);
    expect(teamInTown("Mineola", "")).toBe(false);
  });
});
