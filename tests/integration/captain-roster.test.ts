// Integration tests for /api/captain-roster.
//
// Covers all 6 actions: add, update, remove, approve, reject, revoke.
// Plus the multi-tenant + ownership invariant: captain of team_a can
// never touch team_b's players, no matter what playerId they pass.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockState = {
  decoded: {
    uid: "uid_caller",
    leagues: {} as Record<string, string>,
  } as { uid: string; leagues?: Record<string, string> },
  // Players keyed by `leagueId/playerId` → data
  players: new Map<string, Record<string, unknown>>(),
  // Captured writes/deletes.
  setCalls: [] as Array<{ path: string; data: Record<string, unknown> }>,
  deleteCalls: [] as string[],
};

vi.mock("@/lib/firebase-admin", () => ({
  getAdminAuth: () => ({
    verifyIdToken: vi.fn(async () => mockState.decoded),
  }),
  getAdminDb: () => ({
    doc: (path: string) => {
      const playerMatch = path.match(/^leagues\/([^/]+)\/players\/(.+)$/);
      const key = playerMatch ? `${playerMatch[1]}/${playerMatch[2]}` : null;
      return {
        get: async () => {
          if (!key) return { exists: false, data: () => ({}) };
          const data = mockState.players.get(key);
          return {
            exists: data != null,
            data: () => data ?? {},
          };
        },
        set: async (data: Record<string, unknown>) => {
          mockState.setCalls.push({ path, data });
          // Reflect into mockState so subsequent reads see writes
          // (e.g. add() then verify check).
          if (key) {
            const existing = mockState.players.get(key) ?? {};
            mockState.players.set(key, { ...existing, ...data });
          }
        },
        delete: async () => {
          mockState.deleteCalls.push(path);
          if (key) mockState.players.delete(key);
        },
      };
    },
  }),
  getAdminMessaging: () => ({}),
}));

const { POST } = await import("@/app/api/captain-roster/route");

function makeReq(body: Record<string, unknown>): Request {
  return new Request("http://test/api/captain-roster", {
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
  mockState.players = new Map();
  mockState.setCalls = [];
  mockState.deleteCalls = [];
});

afterEach(() => vi.clearAllMocks());

describe("/api/captain-roster — authority boundary", () => {
  it("rejects non-admin / non-captain callers", async () => {
    mockState.decoded.leagues = { sfbl: "player:p1" };
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        action: "add",
        name: "New Player",
      }),
    );
    expect(res.status).toBe(403);
  });

  it("captain CANNOT update a player on a different team", async () => {
    mockState.decoded.leagues = { sfbl: "captain:team_a" };
    mockState.players.set("sfbl/p1", { team_id: "team_b" });
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        action: "update",
        playerId: "p1",
        name: "Hijacked",
      }),
    );
    expect(res.status).toBe(403);
    expect(mockState.setCalls).toHaveLength(0);
  });

  it("admin without teamId in body is rejected (admin must specify team)", async () => {
    mockState.decoded.leagues = { sfbl: "admin" };
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        action: "add",
        name: "New Player",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects unknown action", async () => {
    mockState.decoded.leagues = { sfbl: "captain:team_a" };
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        action: "flarble",
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("/api/captain-roster — add", () => {
  beforeEach(() => {
    mockState.decoded.leagues = { sfbl: "captain:team_a" };
  });

  it("creates a new player on captain's team with slug-id", async () => {
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        action: "add",
        name: "Aaron Judge",
        num: "99",
        pos: "RF",
      }),
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as { player_id: string };
    expect(data.player_id).toBe("aaron-judge");
    const wrote = mockState.setCalls.find(
      (c) => c.path === "leagues/sfbl/players/aaron-judge",
    );
    expect(wrote).toBeDefined();
    expect(wrote!.data).toMatchObject({
      name: "Aaron Judge",
      team_id: "team_a",
      jersey: 99,
      position: "RF",
      walk_on: true,
      active: true,
    });
  });

  it("collision-suffixes the slug if name is taken", async () => {
    mockState.players.set("sfbl/aaron-judge", {
      name: "Aaron Judge",
      team_id: "team_a",
    });
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        action: "add",
        name: "Aaron Judge",
      }),
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as { player_id: string };
    expect(data.player_id).toBe("aaron-judge-2");
  });

  it("rejects empty name", async () => {
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        action: "add",
        name: "   ",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("admin-added players are NOT walk_on", async () => {
    mockState.decoded.leagues = { sfbl: "admin" };
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        action: "add",
        teamId: "team_a",
        name: "Official Player",
      }),
    );
    expect(res.status).toBe(200);
    const wrote = mockState.setCalls[0]!;
    expect(wrote.data.walk_on).toBe(false);
  });
});

describe("/api/captain-roster — update / remove", () => {
  beforeEach(() => {
    mockState.decoded.leagues = { sfbl: "captain:team_a" };
    mockState.players.set("sfbl/p1", {
      team_id: "team_a",
      name: "Old Name",
    });
  });

  it("updates name + jersey + position", async () => {
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        action: "update",
        playerId: "p1",
        name: "New Name",
        num: 7,
        pos: "SS",
      }),
    );
    expect(res.status).toBe(200);
    const wrote = mockState.setCalls[0]!;
    expect(wrote.data).toMatchObject({
      name: "New Name",
      jersey: 7,
      position: "SS",
    });
    expect(wrote.data.updated_by_uid).toBe("uid_caller");
  });

  it("update with missing playerId fails", async () => {
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        action: "update",
        name: "X",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("remove deletes the doc", async () => {
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        action: "remove",
        playerId: "p1",
      }),
    );
    expect(res.status).toBe(200);
    expect(mockState.deleteCalls).toContain(
      "leagues/sfbl/players/p1",
    );
  });
});

describe("/api/captain-roster — approve / reject", () => {
  beforeEach(() => {
    mockState.decoded.leagues = { sfbl: "captain:team_a" };
  });

  it("approve flips pending_approval to false + stamps approved_at", async () => {
    mockState.players.set("sfbl/p1", {
      team_id: "team_a",
      pending_approval: true,
    });
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        action: "approve",
        playerId: "p1",
      }),
    );
    expect(res.status).toBe(200);
    expect(mockState.setCalls[0]!.data).toMatchObject({
      pending_approval: false,
      approved_by_uid: "uid_caller",
    });
    expect(mockState.setCalls[0]!.data.approved_at).toBeTruthy();
  });

  it("reject deletes the doc only when player IS pending_approval", async () => {
    mockState.players.set("sfbl/p1", {
      team_id: "team_a",
      pending_approval: true,
    });
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        action: "reject",
        playerId: "p1",
      }),
    );
    expect(res.status).toBe(200);
    expect(mockState.deleteCalls).toContain(
      "leagues/sfbl/players/p1",
    );
  });

  it("reject FAILS for a non-pending player (safety: don't delete real rosters)", async () => {
    mockState.players.set("sfbl/p1", {
      team_id: "team_a",
      // No pending_approval flag — this is an active player.
    });
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        action: "reject",
        playerId: "p1",
      }),
    );
    expect(res.status).toBe(400);
    expect(mockState.deleteCalls).toHaveLength(0);
  });
});

describe("/api/captain-roster — revoke", () => {
  it("clears auth_uid + stamps revoked_at", async () => {
    mockState.decoded.leagues = { sfbl: "captain:team_a" };
    mockState.players.set("sfbl/p1", {
      team_id: "team_a",
      auth_uid: "uid_old_player",
    });
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        action: "revoke",
        playerId: "p1",
      }),
    );
    expect(res.status).toBe(200);
    expect(mockState.setCalls[0]!.data).toMatchObject({
      auth_uid: null,
      revoked_by_uid: "uid_caller",
    });
  });
});
