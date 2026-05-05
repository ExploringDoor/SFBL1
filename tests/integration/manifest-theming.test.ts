// Tests for /manifest.webmanifest — verify per-tenant customization
// flows from middleware-injected headers to the served manifest.
//
// Mocks `next/headers` so we can drive the tenant config the route
// reads. Asserts the manifest body has the expected name, theme
// color, icon URL.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockHeaders = {
  "x-tenant-id": "sfbl",
  "x-tenant-config-json": JSON.stringify({
    name: "South Florida Baseball League",
    abbrev: "SFBL",
    theme: {
      primary: "#0c4a6e",
      accent: "#f59e0b",
      logo_url: "/logos/sfbl/sfbl-logo.png",
    },
  }),
};

vi.mock("next/headers", () => ({
  headers: () => ({
    get: (key: string) =>
      mockHeaders[key as keyof typeof mockHeaders] ?? null,
  }),
}));

const { GET } = await import("@/app/manifest.webmanifest/route");

beforeEach(() => {
  // Reset to default before each test.
  mockHeaders["x-tenant-id"] = "sfbl";
  mockHeaders["x-tenant-config-json"] = JSON.stringify({
    name: "South Florida Baseball League",
    abbrev: "SFBL",
    theme: {
      primary: "#0c4a6e",
      accent: "#f59e0b",
      logo_url: "/logos/sfbl/sfbl-logo.png",
    },
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("/manifest.webmanifest — per-tenant rendering", () => {
  it("returns a manifest+json content type", async () => {
    const res = GET();
    expect(res.headers.get("content-type")).toContain(
      "application/manifest+json",
    );
  });

  it("populates name + short_name from tenant config", async () => {
    const res = GET();
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.name).toBe("South Florida Baseball League");
    expect(body.short_name).toBe("SFBL");
  });

  it("uses tenant's primary color as theme_color", async () => {
    const res = GET();
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.theme_color).toBe("#0c4a6e");
  });

  it("uses tenant's logo_url for the icon src", async () => {
    const res = GET();
    const body = (await res.json()) as {
      icons: Array<{ src: string }>;
    };
    expect(body.icons[0]!.src).toBe("/logos/sfbl/sfbl-logo.png");
  });

  it("falls back to defaults when config is missing", async () => {
    mockHeaders["x-tenant-id"] = "";
    mockHeaders["x-tenant-config-json"] = "";
    const res = GET();
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.name).toBe("League");
    expect(body.theme_color).toBe("#0a0e1c");
  });

  it("differentiates between tenants", async () => {
    // First request: SFBL
    const res1 = GET();
    const body1 = (await res1.json()) as Record<string, unknown>;
    expect(body1.name).toBe("South Florida Baseball League");

    // Switch tenant — KCSL
    mockHeaders["x-tenant-id"] = "kcsl";
    mockHeaders["x-tenant-config-json"] = JSON.stringify({
      name: "Kansas City Sandlot League",
      abbrev: "KCSL",
      theme: { primary: "#bd0026", accent: "#ffd700" },
    });
    const res2 = GET();
    const body2 = (await res2.json()) as Record<string, unknown>;
    expect(body2.name).toBe("Kansas City Sandlot League");
    expect(body2.theme_color).toBe("#bd0026");
  });

  it("caches briefly so config changes propagate without forcing reinstall", async () => {
    const res = GET();
    const cc = res.headers.get("cache-control") ?? "";
    expect(cc).toContain("max-age");
    // Should be a short max-age (300s = 5min) — short enough that
    // commissioners see config changes within minutes, long enough
    // that we're not hammering the route on every page load.
    expect(cc).toMatch(/max-age=([1-9]\d{0,2}|[1-9]\d{3})\b/);
  });
});
