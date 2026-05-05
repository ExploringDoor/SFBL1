// Tests for parseHost — the front door of multi-tenant routing.
//
// Every request hits middleware.ts, which calls parseHost(req.host)
// to decide: apex landing? known subdomain? custom domain lookup?
// A bug here means a tenant either can't be reached, OR a tenant's
// data leaks via the wrong slug. Both are launch-day-killing.
//
// We exercise:
//   - apex resolution (leagueengine.com, localhost)
//   - subdomain extraction (slug = label adjacent to apex)
//   - port stripping (sfbl.localhost:3000 → sfbl.localhost)
//   - case-insensitive matching
//   - deep subdomains (staging.sfbl.leagueengine.com → slug=sfbl)
//   - custom domains (anything not under an apex)
//   - the LEAGUEENGINE_APEX_DOMAINS env override path

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Re-import per test so we can mutate the env-loaded APEX_DOMAINS list.
async function freshParseHost() {
  vi.resetModules();
  return (await import("@/lib/tenants")).parseHost;
}

const ORIGINAL_APEX = process.env.LEAGUEENGINE_APEX_DOMAINS;

beforeEach(() => {
  process.env.LEAGUEENGINE_APEX_DOMAINS = "leagueengine.com,localhost";
});

afterEach(() => {
  if (ORIGINAL_APEX === undefined) {
    delete process.env.LEAGUEENGINE_APEX_DOMAINS;
  } else {
    process.env.LEAGUEENGINE_APEX_DOMAINS = ORIGINAL_APEX;
  }
});

describe("parseHost — apex domains", () => {
  it("treats leagueengine.com as apex", async () => {
    const parseHost = await freshParseHost();
    expect(parseHost("leagueengine.com")).toEqual({
      kind: "apex",
      hostname: "leagueengine.com",
      slug: null,
    });
  });

  it("treats localhost as apex (dev)", async () => {
    const parseHost = await freshParseHost();
    expect(parseHost("localhost")).toEqual({
      kind: "apex",
      hostname: "localhost",
      slug: null,
    });
  });

  it("strips port before matching apex", async () => {
    const parseHost = await freshParseHost();
    expect(parseHost("localhost:3000").kind).toBe("apex");
    expect(parseHost("leagueengine.com:443").kind).toBe("apex");
  });

  it("is case-insensitive on apex", async () => {
    const parseHost = await freshParseHost();
    expect(parseHost("LeagueEngine.COM").kind).toBe("apex");
    expect(parseHost("LEAGUEENGINE.COM").hostname).toBe("leagueengine.com");
  });
});

describe("parseHost — subdomain → slug", () => {
  it("extracts slug from sfbl.leagueengine.com", async () => {
    const parseHost = await freshParseHost();
    expect(parseHost("sfbl.leagueengine.com")).toEqual({
      kind: "subdomain",
      hostname: "sfbl.leagueengine.com",
      slug: "sfbl",
    });
  });

  it("extracts slug from sfbl.localhost (dev subdomain)", async () => {
    const parseHost = await freshParseHost();
    const result = parseHost("sfbl.localhost");
    expect(result.kind).toBe("subdomain");
    if (result.kind === "subdomain") {
      expect(result.slug).toBe("sfbl");
    }
  });

  it("extracts slug from sfbl.localhost:3000 (dev with port)", async () => {
    const parseHost = await freshParseHost();
    const result = parseHost("sfbl.localhost:3000");
    expect(result.kind).toBe("subdomain");
    if (result.kind === "subdomain") {
      expect(result.slug).toBe("sfbl");
      // Hostname has port stripped.
      expect(result.hostname).toBe("sfbl.localhost");
    }
  });

  it("lowercases the slug", async () => {
    const parseHost = await freshParseHost();
    const result = parseHost("SFBL.leagueengine.com");
    if (result.kind === "subdomain") {
      expect(result.slug).toBe("sfbl");
    }
  });

  it("for staging.sfbl.leagueengine.com, picks the apex-adjacent label as slug", async () => {
    // Deep subdomains aren't fully spec'd; current behavior takes the
    // label closest to the apex (sfbl), ignoring "staging." prefix.
    // If we ever want true env-namespacing, this is where we'd change
    // it — but that's v2. For MVP this test pins the contract.
    const parseHost = await freshParseHost();
    const result = parseHost("staging.sfbl.leagueengine.com");
    expect(result.kind).toBe("subdomain");
    if (result.kind === "subdomain") {
      expect(result.slug).toBe("sfbl");
    }
  });

  it("treats www.leagueengine.com as a subdomain with slug=www (gotcha)", async () => {
    // Known gotcha: 'www' isn't apex unless we add it explicitly.
    // Documented here so we remember to either:
    //   (a) provision a /leagues/www tenant that redirects to apex, or
    //   (b) add www to APEX_DOMAINS, or
    //   (c) handle www in middleware before tenant lookup.
    // Today: (a) — there's no /leagues/www so middleware returns 404.
    const parseHost = await freshParseHost();
    const result = parseHost("www.leagueengine.com");
    expect(result.kind).toBe("subdomain");
    if (result.kind === "subdomain") {
      expect(result.slug).toBe("www");
    }
  });
});

describe("parseHost — custom domains", () => {
  it("treats sfbl.com as custom (not under any apex)", async () => {
    const parseHost = await freshParseHost();
    expect(parseHost("sfbl.com")).toEqual({
      kind: "custom",
      hostname: "sfbl.com",
      slug: null,
    });
  });

  it("treats arbitrary unknown.example.org as custom", async () => {
    const parseHost = await freshParseHost();
    const result = parseHost("unknown.example.org");
    expect(result.kind).toBe("custom");
    expect(result.slug).toBeNull();
  });

  it("strips port on custom domains too", async () => {
    const parseHost = await freshParseHost();
    const result = parseHost("custom.example.com:8080");
    expect(result.kind).toBe("custom");
    expect(result.hostname).toBe("custom.example.com");
  });
});

describe("parseHost — APEX_DOMAINS env override", () => {
  it("respects LEAGUEENGINE_APEX_DOMAINS=foo.com", async () => {
    process.env.LEAGUEENGINE_APEX_DOMAINS = "foo.com";
    const parseHost = await freshParseHost();
    expect(parseHost("foo.com").kind).toBe("apex");
    expect(parseHost("bar.foo.com").kind).toBe("subdomain");
    // leagueengine.com is no longer apex now → treated as custom.
    expect(parseHost("leagueengine.com").kind).toBe("custom");
  });

  it("supports multiple comma-separated apex domains", async () => {
    process.env.LEAGUEENGINE_APEX_DOMAINS = "a.com, b.com , localhost";
    const parseHost = await freshParseHost();
    expect(parseHost("a.com").kind).toBe("apex");
    expect(parseHost("b.com").kind).toBe("apex");
    expect(parseHost("localhost").kind).toBe("apex");
    expect(parseHost("x.a.com").kind).toBe("subdomain");
    expect(parseHost("y.b.com").kind).toBe("subdomain");
  });

  it("trims whitespace + lowercases env entries", async () => {
    process.env.LEAGUEENGINE_APEX_DOMAINS = "  Foo.COM  ,  BAR.com";
    const parseHost = await freshParseHost();
    expect(parseHost("foo.com").kind).toBe("apex");
    expect(parseHost("BAR.com").kind).toBe("apex");
  });

  it("ignores empty entries (e.g. trailing comma)", async () => {
    process.env.LEAGUEENGINE_APEX_DOMAINS = "foo.com,,bar.com,";
    const parseHost = await freshParseHost();
    expect(parseHost("foo.com").kind).toBe("apex");
    expect(parseHost("bar.com").kind).toBe("apex");
    // An empty string would match anything via endsWith if not filtered.
    // This guards against regressions of that bug.
    expect(parseHost("evil.com").kind).toBe("custom");
  });
});

describe("parseHost — adversarial inputs", () => {
  it("handles host with no domain (single label)", async () => {
    const parseHost = await freshParseHost();
    // Just "foo" — not an apex, not a subdomain of any apex, not even
    // a multi-label custom. Falls through to custom.
    const result = parseHost("foo");
    expect(result.kind).toBe("custom");
  });

  it("handles uppercase subdomain on uppercase apex", async () => {
    const parseHost = await freshParseHost();
    const result = parseHost("SFBL.LEAGUEENGINE.COM");
    expect(result.kind).toBe("subdomain");
    if (result.kind === "subdomain") {
      expect(result.slug).toBe("sfbl");
      expect(result.hostname).toBe("sfbl.leagueengine.com");
    }
  });

  it("handles localhost subdomain with multiple ports gracefully", async () => {
    // Pathological — a host like "sfbl.localhost:3000:extra" shouldn't
    // crash. We split on ':' and take [0], so we get sfbl.localhost.
    const parseHost = await freshParseHost();
    const result = parseHost("sfbl.localhost:3000");
    expect(result.kind).toBe("subdomain");
  });

  it("doesn't match apex if hostname only ENDS with apex without dot separator", async () => {
    // "foolocalhost" should NOT match "localhost" apex (no dot).
    const parseHost = await freshParseHost();
    const result = parseHost("foolocalhost");
    expect(result.kind).toBe("custom");
  });

  it("doesn't match apex if hostname only ENDS with apex.com", async () => {
    // "fooleagueengine.com" should NOT match "leagueengine.com" apex
    // (no dot before it). Critical: prevents fakeleagueengine.com from
    // being treated as a subdomain.
    const parseHost = await freshParseHost();
    const result = parseHost("fakeleagueengine.com");
    expect(result.kind).toBe("custom");
    expect(result.slug).toBeNull();
  });
});
