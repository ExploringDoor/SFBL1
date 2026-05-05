// Integration tests for /api/recalc.
//
// Admin-only endpoint that triggers recalcLeague() — refreshes
// per-player season aggregates from final box scores. Used as a
// belt-and-suspenders manual button on /admin (each captain-submit
// already calls recalc automatically).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockState = {
  decoded: {
    uid: "uid_admin",
    leagues: { sfbl: "admin" } as Record<string, string>,
  } as { uid: string; leagues?: Record<string, string> },
  recalcResult: {
    box_scores_read: 12,
    players_aggregated: 87,
    players_written: 87,
    pitchers_written: 24,
    duration_ms: 142,
  } as Record<string, number>,
  recalcCalls: [] as Array<{ leagueId: string }>,
  recalcThrows: false,
};

vi.mock("@/lib/firebase-admin", () => ({
  getAdminAuth: () => ({
    verifyIdToken: vi.fn(async () => mockState.decoded),
  }),
  getAdminDb: () => ({}),
  getAdminMessaging: () => ({}),
}));

vi.mock("@/lib/stats", () => ({
  recalcLeague: vi.fn(async (_db: unknown, leagueId: string) => {
    mockState.recalcCalls.push({ leagueId });
    if (mockState.recalcThrows) {
      throw new Error("aggregate failed");
    }
    return mockState.recalcResult;
  }),
}));

const { POST } = await import("@/app/api/recalc/route");

function makeReq(body: Record<string, unknown>): Request {
  return new Request("http://test/api/recalc", {
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
  mockState.recalcCalls = [];
  mockState.recalcThrows = false;
});

afterEach(() => vi.clearAllMocks());

describe("/api/recalc — auth", () => {
  it("rejects missing bearer", async () => {
    const req = new Request("http://test/api/recalc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ leagueId: "sfbl" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("rejects captains (admin-only)", async () => {
    mockState.decoded.leagues = { sfbl: "captain:team_a" };
    const res = await POST(makeReq({ leagueId: "sfbl" }));
    expect(res.status).toBe(403);
    expect(mockState.recalcCalls).toHaveLength(0);
  });

  it("rejects admin in different league", async () => {
    mockState.decoded.leagues = { kcsl: "admin" };
    const res = await POST(makeReq({ leagueId: "sfbl" }));
    expect(res.status).toBe(403);
  });
});

describe("/api/recalc — body validation", () => {
  it("rejects missing leagueId", async () => {
    const res = await POST(makeReq({}));
    expect(res.status).toBe(400);
  });
});

describe("/api/recalc — happy path", () => {
  it("calls recalcLeague with the leagueId and returns the result", async () => {
    const res = await POST(makeReq({ leagueId: "sfbl" }));
    expect(res.status).toBe(200);
    expect(mockState.recalcCalls).toHaveLength(1);
    expect(mockState.recalcCalls[0]!.leagueId).toBe("sfbl");
    const data = (await res.json()) as Record<string, number>;
    expect(data.players_aggregated).toBe(87);
    expect(data.duration_ms).toBe(142);
  });
});

describe("/api/recalc — failure mode", () => {
  it("returns 500 with error message when recalcLeague throws", async () => {
    mockState.recalcThrows = true;
    const res = await POST(makeReq({ leagueId: "sfbl" }));
    expect(res.status).toBe(500);
    const data = (await res.json()) as { error: string };
    expect(data.error).toBe("aggregate failed");
  });
});
