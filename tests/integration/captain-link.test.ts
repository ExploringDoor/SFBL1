// Integration tests for /api/captain-link.
//
// Auto-links the calling captain's auth_uid + email to a /players
// record on their team. Mirror of /api/player-link but scoped to
// the captain's team only (player-link is anyone's email anywhere).
//
// Branches: no email on token, 0 matches, 1 match (writes link),
// already-linked (no-op), 2+ matches (ambiguous), match linked to
// someone else (skipped via filter).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface MockPlayer {
  id: string;
  data: Record<string, unknown>;
}

const mockState = {
  decoded: {
    uid: "uid_captain",
    email: "alice@example.com",
    leagues: { sfbl: "captain:team_a" } as Record<string, string>,
  } as { uid: string; email?: string; leagues?: Record<string, string> },
  // Players keyed by id.
  players: new Map<string, MockPlayer>(),
  setCalls: [] as Array<{ path: string; data: Record<string, unknown> }>,
};

vi.mock("@/lib/firebase-admin", () => ({
  getAdminAuth: () => ({
    verifyIdToken: vi.fn(async () => mockState.decoded),
  }),
  getAdminDb: () => ({
    collection: () => ({
      where: () => ({
        get: async () => ({
          docs: [...mockState.players.values()].map((p) => ({
            id: p.id,
            data: () => p.data,
          })),
        }),
      }),
    }),
    doc: (path: string) => ({
      set: async (data: Record<string, unknown>) => {
        mockState.setCalls.push({ path, data });
      },
    }),
  }),
  getAdminMessaging: () => ({}),
}));

const { POST } = await import("@/app/api/captain-link/route");

function makeReq(body: Record<string, unknown>): Request {
  return new Request("http://test/api/captain-link", {
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
    uid: "uid_captain",
    email: "alice@example.com",
    leagues: { sfbl: "captain:team_a" },
  };
  mockState.players = new Map();
  mockState.setCalls = [];
});

afterEach(() => vi.clearAllMocks());

describe("/api/captain-link — auth", () => {
  it("rejects callers without captain claim", async () => {
    mockState.decoded.leagues = { sfbl: "player:p1" };
    const res = await POST(makeReq({ leagueId: "sfbl" }));
    expect(res.status).toBe(403);
  });

  it("rejects callers with admin only (not captain) — admin doesn't auto-link", async () => {
    // captain-link is captain-specific; admin doesn't have a team_id.
    mockState.decoded.leagues = { sfbl: "admin" };
    const res = await POST(makeReq({ leagueId: "sfbl" }));
    expect(res.status).toBe(403);
  });

  it("returns no-op when token has no email", async () => {
    mockState.decoded.email = undefined;
    const res = await POST(makeReq({ leagueId: "sfbl" }));
    expect(res.status).toBe(200);
    const data = (await res.json()) as { matches: number; reason: string };
    expect(data.matches).toBe(0);
    expect(data.reason).toMatch(/no email/i);
  });
});

describe("/api/captain-link — matching", () => {
  it("returns 0 matches when no player has the captain's email", async () => {
    mockState.players.set("p1", {
      id: "p1",
      data: { email: "bob@example.com", team_id: "team_a", active: true },
    });
    const res = await POST(makeReq({ leagueId: "sfbl" }));
    const data = (await res.json()) as { matches: number };
    expect(data.matches).toBe(0);
    expect(mockState.setCalls).toHaveLength(0);
  });

  it("links auth_uid + email when 1 match exists on the captain's team", async () => {
    mockState.players.set("p1", {
      id: "p1",
      data: { email: "alice@example.com", team_id: "team_a", active: true },
    });
    const res = await POST(makeReq({ leagueId: "sfbl" }));
    const data = (await res.json()) as { matches: number; linked: string };
    expect(data.matches).toBe(1);
    expect(data.linked).toBe("p1");
    expect(mockState.setCalls).toHaveLength(1);
    expect(mockState.setCalls[0]!.data).toMatchObject({
      auth_uid: "uid_captain",
      email: "alice@example.com",
    });
  });

  it("returns alreadyLinked:true and skips write when same uid already linked", async () => {
    mockState.players.set("p1", {
      id: "p1",
      data: {
        email: "alice@example.com",
        team_id: "team_a",
        active: true,
        auth_uid: "uid_captain",
      },
    });
    const res = await POST(makeReq({ leagueId: "sfbl" }));
    const data = (await res.json()) as {
      matches: number;
      alreadyLinked: boolean;
    };
    expect(data.matches).toBe(1);
    expect(data.alreadyLinked).toBe(true);
    expect(mockState.setCalls).toHaveLength(0);
  });

  it("ambiguous when 2+ unlinked players match the email on the team", async () => {
    mockState.players.set("p_old", {
      id: "p_old",
      data: { email: "alice@example.com", team_id: "team_a", active: true },
    });
    mockState.players.set("p_new", {
      id: "p_new",
      data: { email: "alice@example.com", team_id: "team_a", active: true },
    });
    const res = await POST(makeReq({ leagueId: "sfbl" }));
    const data = (await res.json()) as {
      matches: number;
      ambiguous: boolean;
    };
    expect(data.matches).toBe(2);
    expect(data.ambiguous).toBe(true);
    expect(mockState.setCalls).toHaveLength(0);
  });

  it("skips inactive players (active:false)", async () => {
    mockState.players.set("p1", {
      id: "p1",
      data: { email: "alice@example.com", team_id: "team_a", active: false },
    });
    const res = await POST(makeReq({ leagueId: "sfbl" }));
    const data = (await res.json()) as { matches: number };
    expect(data.matches).toBe(0);
  });

  it("skips a player record claimed by a different auth_uid", async () => {
    mockState.players.set("p1", {
      id: "p1",
      data: {
        email: "alice@example.com",
        team_id: "team_a",
        active: true,
        auth_uid: "uid_someone_else",
      },
    });
    const res = await POST(makeReq({ leagueId: "sfbl" }));
    const data = (await res.json()) as { matches: number };
    expect(data.matches).toBe(0);
  });
});
