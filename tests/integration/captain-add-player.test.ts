// Integration tests for /api/captain-add-player.
//
// Captain (or admin) adds a walk-on to a roster. Two ownership
// branches:
//   - admin: must specify teamId in body
//   - captain: forced onto their own team — body.teamId ignored
//
// Critical invariant: a captain CAN'T seed a player onto another
// team via this endpoint. Captain-of-team_a is forced to team_a no
// matter what they put in body.teamId.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockState = {
  decoded: {
    uid: "uid_caller",
    leagues: {} as Record<string, string>,
  } as { uid: string; leagues?: Record<string, string> },
  // Existing players keyed by `leagueId/playerId` — used to test
  // collision-suffix on slug generation.
  existingPlayers: new Set<string>(),
  setCalls: [] as Array<{ path: string; data: Record<string, unknown> }>,
};

vi.mock("@/lib/firebase-admin", () => ({
  getAdminAuth: () => ({
    verifyIdToken: vi.fn(async () => mockState.decoded),
  }),
  getAdminDb: () => ({
    doc: (path: string) => ({
      get: async () => ({
        exists: mockState.existingPlayers.has(path),
        data: () => ({}),
      }),
      set: async (data: Record<string, unknown>) => {
        mockState.setCalls.push({ path, data });
        mockState.existingPlayers.add(path);
      },
    }),
  }),
  getAdminMessaging: () => ({}),
}));

const { POST } = await import("@/app/api/captain-add-player/route");

function makeReq(body: Record<string, unknown>): Request {
  return new Request("http://test/api/captain-add-player", {
    method: "POST",
    headers: {
      authorization: "Bearer fake",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockState.decoded = { uid: "uid_caller", leagues: {} };
  mockState.existingPlayers = new Set();
  mockState.setCalls = [];
});

afterEach(() => vi.clearAllMocks());

describe("/api/captain-add-player — auth", () => {
  it("rejects missing bearer", async () => {
    const req = new Request("http://test/api/captain-add-player", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ leagueId: "sfbl", name: "Walk-On" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("rejects player-claim users", async () => {
    mockState.decoded.leagues = { sfbl: "player:p1" };
    const res = await POST(
      makeReq({ leagueId: "sfbl", name: "Walk-On" }),
    );
    expect(res.status).toBe(403);
  });

  it("rejects no-claim-in-this-league callers", async () => {
    mockState.decoded.leagues = { kcsl: "captain:team_b" }; // wrong league
    const res = await POST(
      makeReq({ leagueId: "sfbl", name: "Walk-On" }),
    );
    expect(res.status).toBe(403);
  });
});

describe("/api/captain-add-player — body validation", () => {
  beforeEach(() => {
    mockState.decoded.leagues = { sfbl: "captain:team_a" };
  });

  it("rejects missing leagueId", async () => {
    const res = await POST(makeReq({ name: "Walk-On" }));
    expect(res.status).toBe(400);
  });

  it("rejects missing name", async () => {
    const res = await POST(makeReq({ leagueId: "sfbl" }));
    expect(res.status).toBe(400);
  });

  it("rejects whitespace-only name", async () => {
    const res = await POST(
      makeReq({ leagueId: "sfbl", name: "   " }),
    );
    expect(res.status).toBe(400);
  });
});

describe("/api/captain-add-player — captain creates", () => {
  beforeEach(() => {
    mockState.decoded.leagues = { sfbl: "captain:team_a" };
  });

  it("forces team_id from claim, ignores body.teamId (anti-spoof)", async () => {
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        name: "Aaron Judge",
        teamId: "team_b", // attacker tries to seed onto team_b
      }),
    );
    expect(res.status).toBe(200);
    const wrote = mockState.setCalls[0]!;
    // The endpoint MUST stamp captain's claim team, not the body
    // teamId. This is the invariant test — break it and a captain
    // could pollute every team's roster.
    expect(wrote.data.team_id).toBe("team_a");
  });

  it("flags captain-added players as walk_on:true for admin review", async () => {
    const res = await POST(
      makeReq({ leagueId: "sfbl", name: "Walk-On Wally" }),
    );
    expect(res.status).toBe(200);
    expect(mockState.setCalls[0]!.data.walk_on).toBe(true);
  });

  it("returns the new player_id (slug from name)", async () => {
    const res = await POST(
      makeReq({ leagueId: "sfbl", name: "Aaron Judge", jersey: 99 }),
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as { player_id: string };
    expect(data.player_id).toBe("aaron-judge");
  });

  it("collision-suffixes player_id when slug already taken", async () => {
    mockState.existingPlayers.add("leagues/sfbl/players/aaron-judge");
    const res = await POST(
      makeReq({ leagueId: "sfbl", name: "Aaron Judge" }),
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as { player_id: string };
    expect(data.player_id).toBe("aaron-judge-2");
  });

  it("normalizes weird jersey to null instead of NaN", async () => {
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        name: "Walk-On",
        jersey: "not-a-number",
      }),
    );
    expect(res.status).toBe(200);
    expect(mockState.setCalls[0]!.data.jersey).toBeNull();
  });

  it("stamps active:true + created_by_uid", async () => {
    await POST(
      makeReq({ leagueId: "sfbl", name: "Walk-On" }),
    );
    expect(mockState.setCalls[0]!.data).toMatchObject({
      active: true,
      created_by_uid: "uid_caller",
    });
  });
});

describe("/api/captain-add-player — admin path", () => {
  beforeEach(() => {
    mockState.decoded.leagues = { sfbl: "admin" };
  });

  it("requires teamId in body when admin", async () => {
    const res = await POST(
      makeReq({ leagueId: "sfbl", name: "Walk-On" }),
    );
    expect(res.status).toBe(400);
  });

  it("admin-added players are NOT walk_on (no review needed)", async () => {
    await POST(
      makeReq({
        leagueId: "sfbl",
        name: "Official Player",
        teamId: "team_a",
      }),
    );
    expect(mockState.setCalls[0]!.data.walk_on).toBe(false);
  });

  it("admin can create on any team", async () => {
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        name: "Player On Team B",
        teamId: "team_b",
      }),
    );
    expect(res.status).toBe(200);
    expect(mockState.setCalls[0]!.data.team_id).toBe("team_b");
  });
});
