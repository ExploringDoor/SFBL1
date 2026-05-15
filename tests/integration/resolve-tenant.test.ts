// Regression tests for resolveTenant — audit H3.
//
// /api/player-link is the one self-service-adjacent cross-tenant
// write path: when the caller has no claim on the requested
// leagueId, the endpoint falls back to "does the request HOST
// resolve to that league?" via resolveTenant(parseHost(host)).
// That guard is only as trustworthy as resolveTenant. The audit's
// concern: if env/Edge-Config is missing or wrong, could resolveTenant
// return the WRONG tenant (→ a cross-tenant leak), or could the SFBL
// fast-path fire for a non-sfbl slug?
//
// These tests pin the two invariants player-link relies on:
//   1. SFBL resolves from the "sfbl" SLUG only, with NO env vars and
//      NO Firestore (the hardcoded fast-path) — and never from any
//      other slug/host (the documented past bug where it was
//      hostname-gated and sfbl-1.vercel.app got SFBL).
//   2. Every non-SFBL tenant fails CLOSED to null when the Firebase
//      env vars are absent — never silently to some other tenant.
//
// Both together mean a missing/stale env can only ever turn
// player-link's host check into a 403 (fail-closed), never a
// cross-tenant pass.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function freshTenants() {
  vi.resetModules();
  return await import("@/lib/tenants");
}

const ORIGINAL = {
  apex: process.env.LEAGUEENGINE_APEX_DOMAINS,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
};

beforeEach(() => {
  // parseHost needs an apex list to classify *.leagueengine.com as a
  // subdomain. The Firebase env vars are intentionally REMOVED to
  // simulate the misconfigured/stale-Edge-Config scenario the audit
  // is worried about.
  process.env.LEAGUEENGINE_APEX_DOMAINS = "leagueengine.com,localhost";
  delete process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  delete process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
});

afterEach(() => {
  for (const [k, v] of [
    ["LEAGUEENGINE_APEX_DOMAINS", ORIGINAL.apex],
    ["NEXT_PUBLIC_FIREBASE_PROJECT_ID", ORIGINAL.projectId],
    ["NEXT_PUBLIC_FIREBASE_API_KEY", ORIGINAL.apiKey],
  ] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("resolveTenant — SFBL fast-path (audit H3)", () => {
  it("resolves sfbl.leagueengine.com → {id:'sfbl'} with NO env vars", async () => {
    const { parseHost, resolveTenant } = await freshTenants();
    const tenant = await resolveTenant(parseHost("sfbl.leagueengine.com"));
    expect(tenant?.id).toBe("sfbl");
  });

  it("is slug-gated, not config-gated: an unrelated custom domain never yields sfbl", async () => {
    // The SFBL config is hardcoded in the module, but the fast-path
    // is gated on parsed.slug === "sfbl". A custom domain (slug:null)
    // must NOT inherit SFBL just because its config is in memory —
    // with env missing it fails closed to null instead.
    const { parseHost, resolveTenant } = await freshTenants();
    const tenant = await resolveTenant(parseHost("totally-unrelated.com"));
    expect(tenant?.id).not.toBe("sfbl");
    expect(tenant).toBeNull();
  });

  it("does not leak SFBL to a different apex slug", async () => {
    // A request from lbdc.leagueengine.com must never resolve to sfbl
    // just because the SFBL config is hardcoded.
    const { parseHost, resolveTenant } = await freshTenants();
    const tenant = await resolveTenant(parseHost("lbdc.leagueengine.com"));
    expect(tenant?.id).not.toBe("sfbl");
  });
});

describe("resolveTenant — non-SFBL fails closed (audit H3)", () => {
  it("returns null for a non-sfbl subdomain when Firebase env is absent", async () => {
    const { parseHost, resolveTenant } = await freshTenants();
    const tenant = await resolveTenant(parseHost("lbdc.leagueengine.com"));
    expect(tenant).toBeNull();
  });

  it("returns null for a custom domain when Firebase env is absent", async () => {
    const { parseHost, resolveTenant } = await freshTenants();
    const tenant = await resolveTenant(parseHost("lbdc.com"));
    expect(tenant).toBeNull();
  });

  it("returns null for the bare apex (no tenant)", async () => {
    const { parseHost, resolveTenant } = await freshTenants();
    const tenant = await resolveTenant(parseHost("leagueengine.com"));
    expect(tenant).toBeNull();
  });
});
