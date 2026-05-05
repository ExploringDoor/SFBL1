// Integration tests for /api/admin-team.
//
// Covers create / update / delete actions plus authority + validation.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockState = {
  decoded: {
    uid: "uid_admin",
    leagues: { sfbl: "admin" } as Record<string, string>,
  } as { uid: string; leagues?: Record<string, string> },
  // Teams keyed by `leagueId/teamId`
  teams: new Map<string, Record<string, unknown>>(),
  setCalls: [] as Array<{ path: string; data: Record<string, unknown> }>,
};

vi.mock("@/lib/firebase-admin", () => ({
  getAdminAuth: () => ({
    verifyIdToken: vi.fn(async () => mockState.decoded),
  }),
  getAdminDb: () => ({
    doc: (path: string) => {
      const m = path.match(/^leagues\/([^/]+)\/teams\/(.+)$/);
      const key = m ? `${m[1]}/${m[2]}` : null;
      return {
        get: async () => ({
          exists: key != null && mockState.teams.has(key),
          data: () => (key ? mockState.teams.get(key) : undefined) ?? {},
        }),
        set: async (data: Record<string, unknown>) => {
          mockState.setCalls.push({ path, data });
          if (key) {
            const existing = mockState.teams.get(key) ?? {};
            mockState.teams.set(key, { ...existing, ...data });
          }
        },
      };
    },
  }),
  getAdminMessaging: () => ({}),
}));

const { POST } = await import("@/app/api/admin-team/route");

function makeReq(body: Record<string, unknown>): Request {
  return new Request("http://test/api/admin-team", {
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
  mockState.teams = new Map();
  mockState.setCalls = [];
});

afterEach(() => vi.clearAllMocks());

describe("/api/admin-team — authority + validation", () => {
  it("rejects non-admin callers", async () => {
    mockState.decoded.leagues = { sfbl: "captain:team_a" };
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        action: "create",
        teamId: "team_x",
        name: "X",
      }),
    );
    expect(res.status).toBe(403);
  });

  it("rejects unknown action", async () => {
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        action: "shenanigans",
        teamId: "team_x",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects malformed teamId (uppercase / spaces)", async () => {
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        action: "create",
        teamId: "Team A",
        name: "X",
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("/api/admin-team — create", () => {
  it("creates new team with active:true", async () => {
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        action: "create",
        teamId: "miami_yankees",
        name: "Miami Yankees",
        abbrev: "miy",
        color: "#003087",
        division: "National",
      }),
    );
    expect(res.status).toBe(200);
    const wrote = mockState.setCalls[0]!;
    expect(wrote.data).toMatchObject({
      name: "Miami Yankees",
      abbrev: "MIY", // uppercased
      color: "#003087",
      division: "National",
      active: true,
    });
  });

  it("rejects create without name", async () => {
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        action: "create",
        teamId: "miami_yankees",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("409s if team already exists", async () => {
    mockState.teams.set("sfbl/miami_yankees", {
      name: "Miami Yankees",
    });
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        action: "create",
        teamId: "miami_yankees",
        name: "Miami Yankees",
      }),
    );
    expect(res.status).toBe(409);
  });

  it("rejects malformed hex color", async () => {
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        action: "create",
        teamId: "team_a",
        name: "X",
        color: "not-hex",
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("/api/admin-team — update", () => {
  beforeEach(() => {
    mockState.teams.set("sfbl/miami_yankees", {
      name: "Miami Yankees",
      active: true,
    });
  });

  it("updates name + abbrev", async () => {
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        action: "update",
        teamId: "miami_yankees",
        name: "Miami Bombers",
        abbrev: "BMR",
      }),
    );
    expect(res.status).toBe(200);
    expect(mockState.setCalls[0]!.data).toMatchObject({
      name: "Miami Bombers",
      abbrev: "BMR",
    });
    expect(mockState.setCalls[0]!.data.updated_by_uid).toBe(
      "uid_admin",
    );
  });

  it("404s when team doesn't exist", async () => {
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        action: "update",
        teamId: "ghost_team",
        name: "Ghost",
      }),
    );
    expect(res.status).toBe(404);
  });

  it("rejects logo_url with file:// scheme", async () => {
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        action: "update",
        teamId: "miami_yankees",
        logo_url: "file:///etc/passwd",
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("/api/admin-team — delete (soft)", () => {
  beforeEach(() => {
    mockState.teams.set("sfbl/miami_yankees", {
      name: "Miami Yankees",
      active: true,
    });
  });

  it("sets active:false (soft-delete) and stamps deactivated_at", async () => {
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        action: "delete",
        teamId: "miami_yankees",
      }),
    );
    expect(res.status).toBe(200);
    expect(mockState.setCalls[0]!.data).toMatchObject({
      active: false,
      deactivated_by_uid: "uid_admin",
    });
    expect(mockState.setCalls[0]!.data.deactivated_at).toBeTruthy();
  });
});
