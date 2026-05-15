// Integration tests for /api/captain-payment.
//
// Covers: ownership (captain can only touch own team's players),
// money parsing (numbers, numeric strings, negative + non-finite
// rejected, rounded to cents), legacy paid bool, note field,
// admin override.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockState = {
  decoded: {
    uid: "uid_caller",
    leagues: {} as Record<string, string>,
  } as { uid: string; leagues?: Record<string, string> },
  // Players keyed by `leagueId/playerId` → data
  players: new Map<string, Record<string, unknown>>(),
  // Captured payment writes.
  setCalls: [] as Array<{ path: string; data: Record<string, unknown> }>,
};

vi.mock("@/lib/firebase-admin", () => ({
  getAdminAuth: () => ({
    verifyIdToken: vi.fn(async () => mockState.decoded),
  }),
  getAdminDb: () => ({
    doc: (path: string) => {
      const playerMatch = path.match(/^leagues\/([^/]+)\/players\/(.+)$/);
      if (playerMatch) {
        const data = mockState.players.get(
          `${playerMatch[1]}/${playerMatch[2]}`,
        );
        return {
          get: async () => ({
            exists: data != null,
            data: () => data ?? {},
          }),
        };
      }
      return {
        set: async (data: Record<string, unknown>) => {
          mockState.setCalls.push({ path, data });
        },
      };
    },
  }),
  getAdminMessaging: () => ({}),
}));

const { POST } = await import("@/app/api/captain-payment/route");

function makeReq(body: Record<string, unknown>): Request {
  return new Request("http://test/api/captain-payment", {
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
});

afterEach(() => vi.clearAllMocks());

describe("/api/captain-payment — authority", () => {
  it("rejects callers without captain or admin claim", async () => {
    mockState.decoded.leagues = { sfbl: "player:p1" };
    mockState.players.set("sfbl/p1", { team_id: "team_a" });
    const res = await POST(
      makeReq({ leagueId: "sfbl", playerId: "p1", paid: true }),
    );
    expect(res.status).toBe(403);
  });

  it("captain CANNOT touch a player on a different team", async () => {
    mockState.decoded.leagues = { sfbl: "captain:team_a" };
    mockState.players.set("sfbl/p1", { team_id: "team_b" });
    const res = await POST(
      makeReq({ leagueId: "sfbl", playerId: "p1", paid: true }),
    );
    expect(res.status).toBe(403);
  });

  // Audit H2: admin may touch any team's player, but — like every
  // other captain-* endpoint — must explicitly pass { teamId } and
  // the player must actually be on it. This turns a typo'd playerId
  // into a clean 4xx instead of a silent wrong-player write.
  it("admin CAN touch any team's player when teamId matches", async () => {
    mockState.decoded.leagues = { sfbl: "admin" };
    mockState.players.set("sfbl/p1", { team_id: "team_b" });
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        playerId: "p1",
        teamId: "team_b",
        paid: true,
      }),
    );
    expect(res.status).toBe(200);
  });

  it("admin WITHOUT teamId is rejected (H2 fat-finger guard)", async () => {
    mockState.decoded.leagues = { sfbl: "admin" };
    mockState.players.set("sfbl/p1", { team_id: "team_b" });
    const res = await POST(
      makeReq({ leagueId: "sfbl", playerId: "p1", paid: true }),
    );
    expect(res.status).toBe(400);
  });

  it("admin with MISMATCHED teamId is rejected (catches typo'd playerId)", async () => {
    mockState.decoded.leagues = { sfbl: "admin" };
    mockState.players.set("sfbl/p1", { team_id: "team_b" });
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        playerId: "p1",
        teamId: "team_a",
        paid: true,
      }),
    );
    expect(res.status).toBe(403);
  });
});

describe("/api/captain-payment — money parsing", () => {
  beforeEach(() => {
    mockState.decoded.leagues = { sfbl: "captain:team_a" };
    mockState.players.set("sfbl/p1", { team_id: "team_a" });
  });

  it("accepts numeric values", async () => {
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        playerId: "p1",
        amount_paid: 75,
        amount_due: 100,
      }),
    );
    expect(res.status).toBe(200);
    expect(mockState.setCalls[0]!.data).toMatchObject({
      amount_paid: 75,
      amount_due: 100,
    });
  });

  it("coerces numeric strings to numbers", async () => {
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        playerId: "p1",
        amount_paid: "50.50",
      }),
    );
    expect(res.status).toBe(200);
    expect(mockState.setCalls[0]!.data.amount_paid).toBe(50.5);
  });

  it("rounds to whole cents (no float drift)", async () => {
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        playerId: "p1",
        amount_paid: 75.123456,
      }),
    );
    expect(res.status).toBe(200);
    expect(mockState.setCalls[0]!.data.amount_paid).toBe(75.12);
  });

  it("rejects negative values silently (omits from update)", async () => {
    await POST(
      makeReq({
        leagueId: "sfbl",
        playerId: "p1",
        amount_paid: -10,
      }),
    );
    expect(mockState.setCalls[0]!.data.amount_paid).toBeUndefined();
  });

  it("rejects NaN / Infinity silently", async () => {
    await POST(
      makeReq({
        leagueId: "sfbl",
        playerId: "p1",
        amount_paid: "not-a-number",
      }),
    );
    expect(mockState.setCalls[0]!.data.amount_paid).toBeUndefined();
  });

  it("treats null/empty as clear (writes null)", async () => {
    await POST(
      makeReq({
        leagueId: "sfbl",
        playerId: "p1",
        amount_paid: null,
      }),
    );
    expect(mockState.setCalls[0]!.data.amount_paid).toBeNull();
  });
});

describe("/api/captain-payment — other fields", () => {
  beforeEach(() => {
    mockState.decoded.leagues = { sfbl: "captain:team_a" };
    mockState.players.set("sfbl/p1", { team_id: "team_a" });
  });

  it("writes paid bool when provided", async () => {
    await POST(
      makeReq({ leagueId: "sfbl", playerId: "p1", paid: true }),
    );
    expect(mockState.setCalls[0]!.data.paid).toBe(true);
  });

  it("writes note string when provided", async () => {
    await POST(
      makeReq({
        leagueId: "sfbl",
        playerId: "p1",
        note: "Venmo 4/12",
      }),
    );
    expect(mockState.setCalls[0]!.data.note).toBe("Venmo 4/12");
  });

  it("always stamps team_id + player_id from server-side lookup", async () => {
    mockState.players.set("sfbl/p1", { team_id: "team_a" });
    await POST(
      makeReq({ leagueId: "sfbl", playerId: "p1", paid: true }),
    );
    expect(mockState.setCalls[0]!.data).toMatchObject({
      team_id: "team_a",
      player_id: "p1",
    });
  });

  it("writes to /payments/{playerId} path", async () => {
    await POST(
      makeReq({ leagueId: "sfbl", playerId: "p1", paid: true }),
    );
    expect(mockState.setCalls[0]!.path).toBe(
      "leagues/sfbl/payments/p1",
    );
  });
});

describe("/api/captain-payment — guards", () => {
  it("404s for nonexistent player", async () => {
    mockState.decoded.leagues = { sfbl: "captain:team_a" };
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        playerId: "ghost",
        paid: true,
      }),
    );
    expect(res.status).toBe(404);
  });

  it("requires playerId", async () => {
    mockState.decoded.leagues = { sfbl: "captain:team_a" };
    const res = await POST(
      makeReq({ leagueId: "sfbl", paid: true }),
    );
    expect(res.status).toBe(400);
  });
});
