// Integration test for /api/player-link.
//
// Friday-critical flow: a player magic-links into the league for the
// first time, lands on /profile, and the page mounts the
// usePlayerLink hook which calls this endpoint to find their player
// record by email and stamp auth_uid on it. Subsequent /profile
// loads (and the captain's "Remind Waiting" push tap) all rely on
// that link existing.
//
// We mock @/lib/firebase-admin so we can drive verifyIdToken and the
// /leagues/{id}/players Firestore queries. Asserts the four
// branches: 0 / 1 / 1-already-linked / 2+ matches, plus skipping of
// inactive players and other-uid-claimed players.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface MockPlayer {
  id: string;
  data: {
    name?: string;
    team_id?: string;
    email?: string;
    auth_uid?: string;
    active?: boolean;
  };
}

const mockState = {
  decoded: {
    uid: "uid_player",
    email: "alice@example.com",
  } as { uid: string; email?: string },
  // Players in the league, keyed by id. Filter happens in the mock
  // via `where("email", "==", X)`.
  players: new Map<string, MockPlayer>(),
  // Captured writes from doc().set().
  setCalls: [] as Array<{ path: string; data: Record<string, unknown> }>,
};

// Helper to split a test-seeded player object into public-doc data
// (everything except email/phone) and contact-doc data (just
// email/phone). After PII migration these live in different
// Firestore docs; tests still seed via a flat object for ergonomics.
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
    collection: (path: string) => {
      const m = path.match(/^leagues\/([^/]+)\/players$/);
      if (!m) {
        return {
          where: () => ({ get: async () => ({ docs: [] }) }),
          get: async () => ({ docs: [] }),
        };
      }
      const allDocs = () =>
        Array.from(mockState.players.values()).map((p) => {
          const { publicData } = splitPlayerData(p.data);
          return { id: p.id, data: () => publicData };
        });
      return {
        // Where queries hit the public doc — only public fields exist
        // there post-PII. (Tests that wrote `where("email", "==", x)`
        // are now invalid; player-link no longer queries by email
        // directly.)
        where: (field: string, _op: string, value: unknown) => ({
          get: async () => ({
            docs: allDocs().filter((d) => {
              const v = (d.data() as Record<string, unknown>)[field];
              return v === value;
            }),
          }),
        }),
        get: async () => ({ docs: allDocs() }),
      };
    },
    doc: (path: string) => ({
      get: async () => {
        const contactMatch = path.match(
          /^leagues\/[^/]+\/players\/([^/]+)\/_private\/contact$/,
        );
        if (contactMatch) {
          const player = mockState.players.get(contactMatch[1]!);
          if (!player) return { exists: false, data: () => undefined };
          const { contactData } = splitPlayerData(player.data);
          return { exists: true, data: () => contactData };
        }
        const playerMatch = path.match(
          /^leagues\/[^/]+\/players\/([^/]+)$/,
        );
        if (playerMatch) {
          const player = mockState.players.get(playerMatch[1]!);
          if (!player) return { exists: false, data: () => undefined };
          const { publicData } = splitPlayerData(player.data);
          return { exists: true, data: () => publicData };
        }
        return { exists: false, data: () => undefined };
      },
      set: async (
        data: Record<string, unknown>,
        _opts?: { merge?: boolean },
      ) => {
        mockState.setCalls.push({ path, data });
        // Reflect contact writes back into the seed so re-reads see
        // updates (linked email, etc.).
        const contactMatch = path.match(
          /^leagues\/[^/]+\/players\/([^/]+)\/_private\/contact$/,
        );
        if (contactMatch) {
          const existing = mockState.players.get(contactMatch[1]!);
          if (existing) {
            mockState.players.set(contactMatch[1]!, {
              ...existing,
              data: { ...existing.data, ...data },
            });
          }
          return;
        }
        const m = path.match(/^leagues\/[^/]+\/players\/(.+)$/);
        if (m) {
          const existing = mockState.players.get(m[1]!);
          if (existing) {
            mockState.players.set(m[1]!, {
              ...existing,
              data: { ...existing.data, ...data },
            });
          }
        }
      },
    }),
  }),
  getAdminMessaging: () => ({}),
}));

const { POST } = await import("@/app/api/player-link/route");

function makeReq(body: Record<string, unknown>): Request {
  return new Request("http://test/api/player-link", {
    method: "POST",
    headers: {
      authorization: "Bearer fake",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockState.decoded = { uid: "uid_player", email: "alice@example.com" };
  mockState.players = new Map();
  mockState.setCalls = [];
});

afterEach(() => vi.clearAllMocks());

describe("/api/player-link — input validation", () => {
  it("requires leagueId", async () => {
    const res = await POST(makeReq({}));
    expect(res.status).toBe(400);
  });

  it("rejects missing bearer token", async () => {
    const req = new Request("http://test/api/player-link", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ leagueId: "sfbl" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 0 matches when token has no email claim", async () => {
    mockState.decoded = { uid: "uid_player" }; // no email
    const res = await POST(makeReq({ leagueId: "sfbl" }));
    expect(res.status).toBe(200);
    const data = (await res.json()) as { matches: number; reason: string };
    expect(data.matches).toBe(0);
    expect(data.reason).toMatch(/no email/i);
  });
});

describe("/api/player-link — 0 matches", () => {
  it("returns matches:0 when no player has the user's email", async () => {
    mockState.players.set("p1", {
      id: "p1",
      data: { name: "Bob", team_id: "team_a", email: "bob@example.com" },
    });
    const res = await POST(makeReq({ leagueId: "sfbl" }));
    expect(res.status).toBe(200);
    const data = (await res.json()) as { matches: number };
    expect(data.matches).toBe(0);
    expect(mockState.setCalls).toHaveLength(0);
  });

  it("skips inactive players (active:false)", async () => {
    mockState.players.set("p_inactive", {
      id: "p_inactive",
      data: {
        name: "Alice",
        team_id: "team_a",
        email: "alice@example.com",
        active: false,
      },
    });
    const res = await POST(makeReq({ leagueId: "sfbl" }));
    expect(res.status).toBe(200);
    const data = (await res.json()) as { matches: number };
    expect(data.matches).toBe(0);
  });

  it("skips players already linked to a different auth_uid", async () => {
    // Same email, but auth_uid claimed by someone else — could happen
    // if two people share an email or someone made a typo.
    mockState.players.set("p1", {
      id: "p1",
      data: {
        name: "Alice",
        team_id: "team_a",
        email: "alice@example.com",
        auth_uid: "uid_someone_else",
      },
    });
    const res = await POST(makeReq({ leagueId: "sfbl" }));
    expect(res.status).toBe(200);
    const data = (await res.json()) as { matches: number };
    expect(data.matches).toBe(0);
  });
});

describe("/api/player-link — 1 match (happy path)", () => {
  it("links auth_uid + email when 1 active player matches", async () => {
    mockState.players.set("p1", {
      id: "p1",
      data: { name: "Alice", team_id: "team_a", email: "alice@example.com" },
    });
    const res = await POST(makeReq({ leagueId: "sfbl" }));
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      matches: number;
      linked: string;
      team_id: string;
    };
    expect(data.matches).toBe(1);
    expect(data.linked).toBe("p1");
    expect(data.team_id).toBe("team_a");

    // Two writes post-PII: auth_uid on public doc, email on
    // /_private/contact subdoc.
    expect(mockState.setCalls).toHaveLength(2);
    const publicCall = mockState.setCalls.find(
      (c) => c.path === "leagues/sfbl/players/p1",
    );
    const contactCall = mockState.setCalls.find(
      (c) => c.path === "leagues/sfbl/players/p1/_private/contact",
    );
    expect(publicCall?.data).toMatchObject({ auth_uid: "uid_player" });
    expect(contactCall?.data).toMatchObject({ email: "alice@example.com" });
  });

  it("normalizes email to lowercase before stamping", async () => {
    mockState.decoded.email = "Alice@Example.COM";
    mockState.players.set("p1", {
      id: "p1",
      data: { name: "Alice", team_id: "team_a", email: "alice@example.com" },
    });
    const res = await POST(makeReq({ leagueId: "sfbl" }));
    expect(res.status).toBe(200);
    const contactCall = mockState.setCalls.find((c) =>
      c.path.endsWith("/_private/contact"),
    );
    expect(contactCall?.data.email).toBe("alice@example.com");
  });

  it("returns alreadyLinked:true and skips write when same auth_uid already linked", async () => {
    mockState.players.set("p1", {
      id: "p1",
      data: {
        name: "Alice",
        team_id: "team_a",
        email: "alice@example.com",
        auth_uid: "uid_player", // already mine
      },
    });
    const res = await POST(makeReq({ leagueId: "sfbl" }));
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      matches: number;
      alreadyLinked: boolean;
      player_id: string;
      team_id: string;
    };
    expect(data.matches).toBe(1);
    expect(data.alreadyLinked).toBe(true);
    expect(data.player_id).toBe("p1");
    expect(data.team_id).toBe("team_a");
    // No write — already linked.
    expect(mockState.setCalls).toHaveLength(0);
  });
});

describe("/api/player-link — 2+ matches (ambiguous)", () => {
  it("returns ambiguous + candidates when multiple unlinked players match", async () => {
    mockState.players.set("p_old", {
      id: "p_old",
      data: {
        name: "Alice",
        team_id: "team_legacy",
        email: "alice@example.com",
      },
    });
    mockState.players.set("p_new", {
      id: "p_new",
      data: {
        name: "Alice",
        team_id: "team_a",
        email: "alice@example.com",
      },
    });
    const res = await POST(makeReq({ leagueId: "sfbl" }));
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      matches: number;
      ambiguous: boolean;
      candidates: { id: string; team_id: string }[];
    };
    expect(data.matches).toBe(2);
    expect(data.ambiguous).toBe(true);
    expect(data.candidates).toHaveLength(2);
    const ids = data.candidates.map((c) => c.id).sort();
    expect(ids).toEqual(["p_new", "p_old"]);
    // Don't auto-link when ambiguous.
    expect(mockState.setCalls).toHaveLength(0);
  });

  it("ignores already-other-linked rows when counting matches", async () => {
    // 1 record claimed by someone else → effectively invisible.
    // 1 record unlinked → that's the unique match.
    mockState.players.set("p_stranger", {
      id: "p_stranger",
      data: {
        name: "Alice",
        team_id: "team_x",
        email: "alice@example.com",
        auth_uid: "uid_stranger",
      },
    });
    mockState.players.set("p_mine", {
      id: "p_mine",
      data: {
        name: "Alice",
        team_id: "team_a",
        email: "alice@example.com",
      },
    });
    const res = await POST(makeReq({ leagueId: "sfbl" }));
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      matches: number;
      linked?: string;
      ambiguous?: boolean;
    };
    expect(data.matches).toBe(1);
    expect(data.linked).toBe("p_mine");
    expect(data.ambiguous).toBeUndefined();
  });
});
