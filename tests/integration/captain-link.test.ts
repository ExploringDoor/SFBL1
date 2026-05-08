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

// Split test-seeded player data into public-doc fields vs PII
// (which post-PII migration lives at /_private/contact). Tests
// still seed via a flat object for ergonomics; the mock's doc()
// handler routes by path.
function splitPlayerData(d: Record<string, unknown>): {
  publicData: Record<string, unknown>;
  contactData: Record<string, unknown>;
} {
  const { email, phone, ...rest } = d;
  return {
    publicData: rest,
    contactData: {
      ...(email !== undefined ? { email } : {}),
      ...(phone !== undefined ? { phone } : {}),
    },
  };
}

vi.mock("@/lib/firebase-admin", () => ({
  getAdminAuth: () => ({
    verifyIdToken: vi.fn(async () => mockState.decoded),
  }),
  getAdminDb: () => ({
    collection: () => ({
      where: () => ({
        get: async () => ({
          docs: [...mockState.players.values()].map((p) => {
            const { publicData } = splitPlayerData(p.data);
            return {
              id: p.id,
              data: () => publicData,
              ref: {
                collection: (sub: string) => ({
                  doc: (id: string) => ({
                    get: async () => {
                      if (sub === "_private" && id === "contact") {
                        const { contactData } = splitPlayerData(p.data);
                        return {
                          exists: Object.keys(contactData).length > 0,
                          data: () => contactData,
                        };
                      }
                      return { exists: false, data: () => undefined };
                    },
                  }),
                }),
              },
            };
          }),
        }),
      }),
    }),
    doc: (path: string) => ({
      set: async (data: Record<string, unknown>) => {
        mockState.setCalls.push({ path, data });
      },
      get: async () => {
        // captain-link reads /_private/contact directly via
        // db.doc(...) (not via d.ref.collection). Route to the
        // appropriate seed.
        const m = path.match(
          /^leagues\/[^/]+\/players\/([^/]+)\/_private\/contact$/,
        );
        if (m) {
          const player = mockState.players.get(m[1]!);
          if (!player) return { exists: false, data: () => undefined };
          const { contactData } = splitPlayerData(player.data);
          return {
            exists: Object.keys(contactData).length > 0,
            data: () => contactData,
          };
        }
        return { exists: false, data: () => undefined };
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
    // Two writes post-PII: public doc gets auth_uid, /_private/contact
    // gets email.
    expect(mockState.setCalls).toHaveLength(2);
    const publicCall = mockState.setCalls.find(
      (c) => !c.path.includes("/_private/"),
    );
    const contactCall = mockState.setCalls.find((c) =>
      c.path.includes("/_private/contact"),
    );
    expect(publicCall?.data).toMatchObject({ auth_uid: "uid_captain" });
    expect(contactCall?.data).toMatchObject({ email: "alice@example.com" });
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
