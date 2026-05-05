// Integration tests for /api/availability-rsvp.
//
// Friday-critical: this is what powers both the captain Attendance
// tab AND the player /profile#avail panel. Two ownership models:
//   - captain: can RSVP for any player on their own team
//   - player:  can RSVP only for their own linked player record
//   - admin:   anything goes
// Plus status validation (yes/maybe/no/clear) and game-belongs-to-team
// validation so a leagueId-scoped attack doesn't write into another
// team's availability docs.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockState = {
  decoded: {
    uid: "uid_caller",
    leagues: {} as Record<string, string>,
  } as { uid: string; leagues?: Record<string, string> },
  // Players keyed by `leagueId/playerId` → data
  players: new Map<string, Record<string, unknown>>(),
  // Games keyed by `leagueId/gameId` → data
  games: new Map<string, Record<string, unknown>>(),
  // Captured availability writes/deletes by docId.
  setCalls: [] as Array<{ path: string; data: Record<string, unknown> }>,
  deleteCalls: [] as string[],
};

vi.mock("@/lib/firebase-admin", () => ({
  getAdminAuth: () => ({
    verifyIdToken: vi.fn(async () => mockState.decoded),
  }),
  getAdminDb: () => ({
    doc: (path: string) => {
      // /leagues/{lid}/players/{pid}
      const playerMatch = path.match(/^leagues\/([^/]+)\/players\/(.+)$/);
      if (playerMatch) {
        const key = `${playerMatch[1]}/${playerMatch[2]}`;
        const data = mockState.players.get(key);
        return {
          get: async () => ({
            exists: data != null,
            data: () => data ?? {},
          }),
          set: async () => {
            /* unused in availability tests */
          },
          delete: async () => {
            /* unused */
          },
        };
      }
      // /leagues/{lid}/games/{gid}
      const gameMatch = path.match(/^leagues\/([^/]+)\/games\/(.+)$/);
      if (gameMatch) {
        const key = `${gameMatch[1]}/${gameMatch[2]}`;
        const data = mockState.games.get(key);
        return {
          get: async () => ({
            exists: data != null,
            data: () => data ?? {},
          }),
        };
      }
      // /leagues/{lid}/availability/{docId}
      return {
        get: async () => ({ exists: false, data: () => ({}) }),
        set: async (data: Record<string, unknown>) => {
          mockState.setCalls.push({ path, data });
        },
        delete: async () => {
          mockState.deleteCalls.push(path);
        },
      };
    },
  }),
  getAdminMessaging: () => ({}),
}));

const { POST } = await import("@/app/api/availability-rsvp/route");

function makeReq(body: Record<string, unknown>): Request {
  return new Request("http://test/api/availability-rsvp", {
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
  mockState.games = new Map();
  mockState.setCalls = [];
  mockState.deleteCalls = [];
});

afterEach(() => vi.clearAllMocks());

describe("/api/availability-rsvp — input validation", () => {
  it("rejects missing leagueId", async () => {
    const res = await POST(
      makeReq({ gameId: "g1", playerId: "p1", status: "yes" }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects unknown status", async () => {
    mockState.decoded.leagues = { sfbl: "captain:team_a" };
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        gameId: "g1",
        playerId: "p1",
        status: "skipping",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects ids with slashes (path traversal guard)", async () => {
    mockState.decoded.leagues = { sfbl: "captain:team_a" };
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        gameId: "g1/escaped",
        playerId: "p1",
        status: "yes",
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("/api/availability-rsvp — captain authority", () => {
  it("captain can RSVP for any player on their own team", async () => {
    mockState.decoded.leagues = { sfbl: "captain:team_a" };
    mockState.players.set("sfbl/p1", { name: "Alice", team_id: "team_a" });
    mockState.games.set("sfbl/g1", {
      away_team_id: "team_a",
      home_team_id: "team_b",
    });
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        gameId: "g1",
        playerId: "p1",
        status: "yes",
      }),
    );
    expect(res.status).toBe(200);
    expect(mockState.setCalls).toHaveLength(1);
    expect(mockState.setCalls[0]!.path).toBe(
      "leagues/sfbl/availability/team_a_g1_p1",
    );
    expect(mockState.setCalls[0]!.data).toMatchObject({
      game_id: "g1",
      player_id: "p1",
      team_id: "team_a",
      status: "yes",
    });
  });

  it("captain CANNOT RSVP for a player on a different team", async () => {
    mockState.decoded.leagues = { sfbl: "captain:team_a" };
    mockState.players.set("sfbl/p1", { name: "Bob", team_id: "team_b" });
    mockState.games.set("sfbl/g1", {
      away_team_id: "team_a",
      home_team_id: "team_b",
    });
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        gameId: "g1",
        playerId: "p1",
        status: "yes",
      }),
    );
    expect(res.status).toBe(403);
    expect(mockState.setCalls).toHaveLength(0);
  });
});

describe("/api/availability-rsvp — player authority", () => {
  it("player can RSVP for their own linked player record", async () => {
    mockState.decoded = {
      uid: "uid_alice",
      leagues: { sfbl: "player:p1" },
    };
    mockState.players.set("sfbl/p1", {
      name: "Alice",
      team_id: "team_a",
      auth_uid: "uid_alice",
    });
    mockState.games.set("sfbl/g1", {
      away_team_id: "team_a",
      home_team_id: "team_b",
    });
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        gameId: "g1",
        playerId: "p1",
        status: "maybe",
      }),
    );
    expect(res.status).toBe(200);
  });

  it("player CANNOT RSVP for someone else's player record", async () => {
    mockState.decoded = {
      uid: "uid_alice",
      leagues: { sfbl: "player:p1" },
    };
    mockState.players.set("sfbl/p2", {
      name: "Bob",
      team_id: "team_a",
      auth_uid: "uid_bob",
    });
    mockState.games.set("sfbl/g1", {
      away_team_id: "team_a",
      home_team_id: "team_b",
    });
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        gameId: "g1",
        playerId: "p2",
        status: "no",
      }),
    );
    expect(res.status).toBe(403);
  });
});

describe("/api/availability-rsvp — clear (delete)", () => {
  it("clear status deletes the doc", async () => {
    mockState.decoded.leagues = { sfbl: "captain:team_a" };
    mockState.players.set("sfbl/p1", { name: "Alice", team_id: "team_a" });
    mockState.games.set("sfbl/g1", {
      away_team_id: "team_a",
      home_team_id: "team_b",
    });
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        gameId: "g1",
        playerId: "p1",
        status: "clear",
      }),
    );
    expect(res.status).toBe(200);
    expect(mockState.deleteCalls).toHaveLength(1);
    expect(mockState.deleteCalls[0]).toBe(
      "leagues/sfbl/availability/team_a_g1_p1",
    );
    expect(mockState.setCalls).toHaveLength(0);
  });
});

describe("/api/availability-rsvp — game integrity", () => {
  it("rejects RSVP for a game that doesn't involve this team", async () => {
    mockState.decoded.leagues = { sfbl: "captain:team_a" };
    mockState.players.set("sfbl/p1", { name: "Alice", team_id: "team_a" });
    // Game between team_b and team_c — team_a not involved.
    mockState.games.set("sfbl/g1", {
      away_team_id: "team_b",
      home_team_id: "team_c",
    });
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        gameId: "g1",
        playerId: "p1",
        status: "yes",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("404s when game doesn't exist", async () => {
    mockState.decoded.leagues = { sfbl: "captain:team_a" };
    mockState.players.set("sfbl/p1", { name: "Alice", team_id: "team_a" });
    // No game registered.
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        gameId: "g_nonexistent",
        playerId: "p1",
        status: "yes",
      }),
    );
    expect(res.status).toBe(404);
  });
});
