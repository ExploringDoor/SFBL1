// Integration tests for /api/admin-branding.
//
// Confirms the endpoint:
//   - rejects non-admin callers
//   - validates hex color format
//   - validates logo_url shape (path or https)
//   - merges into /leagues/{id} without clobbering unrelated fields
//   - stamps updated_at + updated_by_uid

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockState = {
  decoded: {
    uid: "uid_admin",
    leagues: { sfbl: "admin" } as Record<string, string>,
  } as { uid: string; leagues?: Record<string, string> },
  setCalls: [] as Array<{
    path: string;
    data: Record<string, unknown>;
    merge: boolean;
  }>,
};

vi.mock("@/lib/firebase-admin", () => ({
  getAdminAuth: () => ({
    verifyIdToken: vi.fn(async () => mockState.decoded),
  }),
  getAdminDb: () => ({
    doc: (path: string) => ({
      set: async (
        data: Record<string, unknown>,
        opts?: { merge?: boolean },
      ) => {
        mockState.setCalls.push({
          path,
          data,
          merge: opts?.merge === true,
        });
      },
    }),
  }),
  getAdminMessaging: () => ({}),
}));

const { POST } = await import("@/app/api/admin-branding/route");

function makeReq(body: Record<string, unknown>): Request {
  return new Request("http://test/api/admin-branding", {
    method: "POST",
    headers: {
      authorization: "Bearer fake",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockState.decoded = {
    uid: "uid_admin",
    leagues: { sfbl: "admin" },
  };
  mockState.setCalls = [];
});

afterEach(() => vi.clearAllMocks());

describe("/api/admin-branding — authority", () => {
  it("rejects callers without admin claim", async () => {
    mockState.decoded.leagues = { sfbl: "captain:team_a" };
    const res = await POST(
      makeReq({ leagueId: "sfbl", name: "SFBL Renamed" }),
    );
    expect(res.status).toBe(403);
    expect(mockState.setCalls).toHaveLength(0);
  });

  it("rejects callers with admin in a different league", async () => {
    mockState.decoded.leagues = { kcsl: "admin" };
    const res = await POST(
      makeReq({ leagueId: "sfbl", name: "SFBL Renamed" }),
    );
    expect(res.status).toBe(403);
  });
});

describe("/api/admin-branding — name + abbrev", () => {
  it("updates name and abbrev", async () => {
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        name: "South Florida Baseball League",
        abbrev: "SFBL",
      }),
    );
    expect(res.status).toBe(200);
    expect(mockState.setCalls).toHaveLength(1);
    expect(mockState.setCalls[0]!.path).toBe("leagues/sfbl");
    expect(mockState.setCalls[0]!.data).toMatchObject({
      name: "South Florida Baseball League",
      abbrev: "SFBL",
    });
    expect(mockState.setCalls[0]!.merge).toBe(true);
  });

  it("uppercases abbrev automatically", async () => {
    await POST(
      makeReq({ leagueId: "sfbl", abbrev: "sfbl" }),
    );
    expect(mockState.setCalls[0]!.data.abbrev).toBe("SFBL");
  });

  it("rejects name that's too long", async () => {
    const longName = "x".repeat(101);
    const res = await POST(
      makeReq({ leagueId: "sfbl", name: longName }),
    );
    expect(res.status).toBe(400);
  });
});

describe("/api/admin-branding — theme colors", () => {
  it("accepts valid hex colors", async () => {
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        theme: {
          primary: "#0c4a6e",
          accent: "#f59e0b",
          secondary: "#fff",
        },
      }),
    );
    expect(res.status).toBe(200);
    expect(mockState.setCalls[0]!.data.theme).toMatchObject({
      primary: "#0c4a6e",
      accent: "#f59e0b",
      secondary: "#fff",
    });
  });

  it("rejects non-hex colors", async () => {
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        theme: { primary: "not-a-color" },
      }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects rgb() syntax", async () => {
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        theme: { primary: "rgb(12, 74, 110)" },
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("/api/admin-branding — logo_url", () => {
  it("accepts an absolute path", async () => {
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        theme: { logo_url: "/logos/sfbl/sfbl-logo.png" },
      }),
    );
    expect(res.status).toBe(200);
    expect(
      (mockState.setCalls[0]!.data.theme as { logo_url: string }).logo_url,
    ).toBe("/logos/sfbl/sfbl-logo.png");
  });

  it("accepts a https URL", async () => {
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        theme: { logo_url: "https://example.com/logo.png" },
      }),
    );
    expect(res.status).toBe(200);
  });

  it("accepts empty string to clear logo", async () => {
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        theme: { logo_url: "" },
      }),
    );
    expect(res.status).toBe(200);
  });

  it("rejects file:// or other schemes", async () => {
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        theme: { logo_url: "file:///etc/passwd" },
      }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects bare relative paths (no leading /)", async () => {
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        theme: { logo_url: "logos/sfbl/x.png" },
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("/api/admin-branding — guards", () => {
  it("rejects empty body (no fields to update)", async () => {
    const res = await POST(makeReq({ leagueId: "sfbl" }));
    expect(res.status).toBe(400);
  });

  it("requires leagueId", async () => {
    const res = await POST(makeReq({ name: "Whatever" }));
    expect(res.status).toBe(400);
  });

  it("stamps updated_at + updated_by_uid", async () => {
    await POST(
      makeReq({
        leagueId: "sfbl",
        name: "SFBL Renamed",
      }),
    );
    expect(mockState.setCalls[0]!.data.updated_at).toBeTruthy();
    expect(mockState.setCalls[0]!.data.updated_by_uid).toBe("uid_admin");
  });
});
