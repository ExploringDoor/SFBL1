// Integration tests for /api/chat-message — captain/player chat.
//
// Two collections behind one route, with different authority rules:
//   - team_messages: captain of {teamId} OR player on {teamId} (or admin)
//   - captain_chat:  captain (any team) in this league (or admin)
//
// The route also resolves the sender's display name (preferring the
// linked player record on this team, falling back to token name then
// email local-part), enriches with team metadata, writes the message
// doc, and fan-outs a push to /api/send-notification with a deep link.
//
// Why this needs hard test coverage:
//   1. A captain of team_a must NOT be able to post to team_b's chat
//   2. A player NOT on team_a must NOT be able to post to team_a chat
//   3. The author name must resolve to the linked player's record
//      (so messages show "Sarah J." not "sarah.j" or "Captain")
//   4. team_messages push goes to /profile#teamchat (universal),
//      captains_chat push goes to /captain#captchat (captain-only)
//   5. The sender's own device must be excludable via senderToken
//   6. Push failure must NOT fail the chat write — the in-app message
//      is the source of truth

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface DocState {
  data: Record<string, unknown>;
}

const mockState = {
  decoded: {
    uid: "uid_captain",
    email: "captain@example.com",
    leagues: { sfbl: "captain:team_a" } as Record<string, string>,
  } as {
    uid: string;
    email?: string;
    name?: string;
    leagues?: Record<string, string>;
  },
  // Firestore: docs at exact paths.
  docs: new Map<string, DocState>(),
  // Player records: list of (id, data) — supports .where(auth_uid)
  // .where(team_id) .limit() .get() chain.
  players: [] as Array<{ id: string; data: Record<string, unknown> }>,
  // Captured set() / add() calls.
  setCalls: [] as Array<{ path: string; data: Record<string, unknown> }>,
  // Captured fetch calls (route POSTs to /api/send-notification).
  fetchCalls: [] as Array<{ url: string; body: Record<string, unknown> }>,
  // Failure toggles.
  verifyThrows: false,
  fetchThrows: false,
  // Auto-id counter for collection.doc().
  nextDocId: 1,
};

vi.mock("firebase-admin/firestore", () => ({
  Timestamp: {
    now: () => ({ seconds: 1746489600, nanoseconds: 0 }),
  },
}));

vi.mock("@/lib/firebase-admin", () => ({
  getAdminAuth: () => ({
    verifyIdToken: vi.fn(async () => {
      if (mockState.verifyThrows) throw new Error("token expired");
      return mockState.decoded;
    }),
  }),
  getAdminDb: () => ({
    doc: (path: string) => ({
      get: async () => {
        const ds = mockState.docs.get(path);
        return {
          exists: ds != null,
          data: () => ds?.data ?? {},
        };
      },
      set: async (data: Record<string, unknown>) => {
        mockState.setCalls.push({ path, data });
        mockState.docs.set(path, { data });
      },
    }),
    collection: (collPath: string) => {
      // chainable .where().where().limit().get() for /players queries
      // and .doc() (auto-id) + .set() for the message write.
      const filterChain = (filters: Array<[string, string, unknown]>) => {
        return {
          where: (f: string, op: string, v: unknown) =>
            filterChain([...filters, [f, op, v]]),
          limit: (_n: number) => filterChain(filters),
          get: async () => {
            // Only /players collection is filtered in this route. For
            // anything else, return empty.
            if (!collPath.endsWith("/players")) {
              return { empty: true, docs: [] };
            }
            const matched = mockState.players.filter((p) =>
              filters.every(([field, op, value]) =>
                op === "==" ? p.data[field] === value : true,
              ),
            );
            return {
              empty: matched.length === 0,
              docs: matched.map((m) => ({
                id: m.id,
                data: () => m.data,
              })),
            };
          },
        };
      };
      return {
        ...filterChain([]),
        doc: (id?: string) => {
          const docId = id ?? "auto_" + mockState.nextDocId++;
          const fullPath = `${collPath}/${docId}`;
          return {
            id: docId,
            get: async () => {
              const ds = mockState.docs.get(fullPath);
              return { exists: ds != null, data: () => ds?.data ?? {} };
            },
            set: async (data: Record<string, unknown>) => {
              mockState.setCalls.push({ path: fullPath, data });
              mockState.docs.set(fullPath, { data });
            },
          };
        },
      };
    },
  }),
  getAdminMessaging: () => ({}),
}));

const { POST } = await import("@/app/api/chat-message/route");

function makeReq(body: Record<string, unknown>): Request {
  return new Request("http://test/api/chat-message", {
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
    email: "captain@example.com",
    leagues: { sfbl: "captain:team_a" },
  };
  mockState.docs = new Map();
  mockState.players = [];
  mockState.setCalls = [];
  mockState.fetchCalls = [];
  mockState.verifyThrows = false;
  mockState.fetchThrows = false;
  mockState.nextDocId = 1;

  // Default fixture: team_a + team_b exist.
  mockState.docs.set("leagues/sfbl/teams/team_a", {
    data: { name: "Yankees", color: "#003087", abbrev: "NYY" },
  });
  mockState.docs.set("leagues/sfbl/teams/team_b", {
    data: { name: "Red Sox", color: "#bd3039", abbrev: "BOS" },
  });

  // Stub global fetch to capture send-notification calls.
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (mockState.fetchThrows) throw new Error("fetch failed");
      mockState.fetchCalls.push({
        url,
        body: JSON.parse(String(init?.body ?? "{}")),
      });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }),
  );
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

// ── auth + body ───────────────────────────────────────────────────

describe("/api/chat-message — auth + body validation", () => {
  it("401 missing bearer", async () => {
    const req = new Request("http://test/api/chat-message", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        leagueId: "sfbl",
        collection: "team_messages",
        teamId: "team_a",
        text: "hi",
      }),
    });
    expect((await POST(req)).status).toBe(401);
  });

  it("401 expired/invalid token", async () => {
    mockState.verifyThrows = true;
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        collection: "team_messages",
        teamId: "team_a",
        text: "hi",
      }),
    );
    expect(res.status).toBe(401);
    expect(mockState.setCalls).toHaveLength(0);
  });

  it("400 missing leagueId", async () => {
    expect(
      (
        await POST(
          makeReq({ collection: "team_messages", teamId: "team_a", text: "hi" }),
        )
      ).status,
    ).toBe(400);
  });

  it("400 invalid collection", async () => {
    expect(
      (
        await POST(
          makeReq({
            leagueId: "sfbl",
            collection: "global_chat",
            teamId: "team_a",
            text: "hi",
          }),
        )
      ).status,
    ).toBe(400);
  });

  it("400 empty text", async () => {
    expect(
      (
        await POST(
          makeReq({
            leagueId: "sfbl",
            collection: "team_messages",
            teamId: "team_a",
            text: "   ",
          }),
        )
      ).status,
    ).toBe(400);
  });

  it("400 text over 2000 chars", async () => {
    expect(
      (
        await POST(
          makeReq({
            leagueId: "sfbl",
            collection: "team_messages",
            teamId: "team_a",
            text: "x".repeat(2001),
          }),
        )
      ).status,
    ).toBe(400);
  });

  it("400 team_messages without teamId", async () => {
    expect(
      (
        await POST(
          makeReq({
            leagueId: "sfbl",
            collection: "team_messages",
            text: "hi",
          }),
        )
      ).status,
    ).toBe(400);
  });
});

// ── authority for team_messages ──────────────────────────────────

describe("/api/chat-message — team_messages authority", () => {
  it("admin can post to any team", async () => {
    mockState.decoded.leagues = { sfbl: "admin" };
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        collection: "team_messages",
        teamId: "team_a",
        text: "admin announce",
      }),
    );
    expect(res.status).toBe(200);
  });

  it("captain of team_a CAN post to team_a", async () => {
    mockState.decoded.leagues = { sfbl: "captain:team_a" };
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        collection: "team_messages",
        teamId: "team_a",
        text: "captains' note",
      }),
    );
    expect(res.status).toBe(200);
  });

  it("captain of team_a CANNOT post to team_b (cross-team leak guard)", async () => {
    mockState.decoded.leagues = { sfbl: "captain:team_a" };
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        collection: "team_messages",
        teamId: "team_b",
        text: "trolling",
      }),
    );
    expect(res.status).toBe(403);
    expect(mockState.setCalls).toHaveLength(0);
    expect(mockState.fetchCalls).toHaveLength(0);
  });

  it("player on team_a CAN post to team_a", async () => {
    mockState.decoded.leagues = { sfbl: "player:p1" };
    mockState.players.push({
      id: "p1",
      data: { auth_uid: "uid_captain", team_id: "team_a", name: "Sarah J" },
    });
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        collection: "team_messages",
        teamId: "team_a",
        text: "from a player",
      }),
    );
    expect(res.status).toBe(200);
  });

  it("player NOT on team_a CANNOT post to team_a", async () => {
    mockState.decoded.leagues = { sfbl: "player:p1" };
    mockState.players.push({
      id: "p1",
      data: { auth_uid: "uid_captain", team_id: "team_b", name: "Wrong" },
    });
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        collection: "team_messages",
        teamId: "team_a",
        text: "leak attempt",
      }),
    );
    expect(res.status).toBe(403);
    expect(mockState.setCalls).toHaveLength(0);
  });
});

// ── authority for captain_chat ────────────────────────────────────

describe("/api/chat-message — captain_chat authority", () => {
  it("admin can post", async () => {
    mockState.decoded.leagues = { sfbl: "admin" };
    expect(
      (
        await POST(
          makeReq({
            leagueId: "sfbl",
            collection: "captain_chat",
            text: "admin",
          }),
        )
      ).status,
    ).toBe(200);
  });

  it("captain of any team can post", async () => {
    mockState.decoded.leagues = { sfbl: "captain:team_b" };
    expect(
      (
        await POST(
          makeReq({
            leagueId: "sfbl",
            collection: "captain_chat",
            text: "captains-only thread",
          }),
        )
      ).status,
    ).toBe(200);
  });

  it("player CANNOT post in captain_chat", async () => {
    mockState.decoded.leagues = { sfbl: "player:p1" };
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        collection: "captain_chat",
        text: "shouldn't be here",
      }),
    );
    expect(res.status).toBe(403);
    expect(mockState.setCalls).toHaveLength(0);
  });

  it("teamId is ignored for captain_chat (no cross-team validation)", async () => {
    mockState.decoded.leagues = { sfbl: "captain:team_a" };
    // Even with teamId="team_b" specified, the route ignores it
    // because captain_chat doesn't scope by team.
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        collection: "captain_chat",
        teamId: "team_b",
        text: "captains chat",
      }),
    );
    expect(res.status).toBe(200);
  });
});

// ── author name resolution ────────────────────────────────────────

describe("/api/chat-message — author name resolution", () => {
  it("uses linked player.name when present on the message's team", async () => {
    mockState.decoded.leagues = { sfbl: "captain:team_a" };
    mockState.players.push({
      id: "p1",
      data: {
        auth_uid: "uid_captain",
        team_id: "team_a",
        name: "Aaron Judge",
      },
    });
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        collection: "team_messages",
        teamId: "team_a",
        text: "good game",
      }),
    );
    const data = (await res.json()) as { author_name: string };
    expect(data.author_name).toBe("Aaron Judge");
  });

  it("falls back to email local-part when no linked player", async () => {
    mockState.decoded = {
      uid: "uid_captain",
      email: "joe.smith@example.com",
      leagues: { sfbl: "captain:team_a" },
    };
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        collection: "team_messages",
        teamId: "team_a",
        text: "first post",
      }),
    );
    const data = (await res.json()) as { author_name: string };
    expect(data.author_name).toBe("joe.smith");
  });

  it("uses decoded.name (display name) when available and no linked player", async () => {
    mockState.decoded = {
      uid: "uid_captain",
      email: "x@example.com",
      name: "Joe Smith",
      leagues: { sfbl: "captain:team_a" },
    };
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        collection: "team_messages",
        teamId: "team_a",
        text: "hello",
      }),
    );
    const data = (await res.json()) as { author_name: string };
    expect(data.author_name).toBe("Joe Smith");
  });
});

// ── message doc shape ─────────────────────────────────────────────

describe("/api/chat-message — message doc shape", () => {
  it("writes the message doc with the canonical shape", async () => {
    mockState.decoded.leagues = { sfbl: "captain:team_a" };
    await POST(
      makeReq({
        leagueId: "sfbl",
        collection: "team_messages",
        teamId: "team_a",
        text: "  important  ",
      }),
    );
    const msgWrite = mockState.setCalls.find((c) =>
      c.path.startsWith("leagues/sfbl/team_messages/"),
    );
    expect(msgWrite).toBeDefined();
    const data = msgWrite!.data;
    // Trimmed.
    expect(data.text).toBe("important");
    // Standard fields.
    expect(data.author_email).toBe("captain@example.com");
    expect(data.author_uid).toBe("uid_captain");
    expect(data.is_captain).toBe(true);
    expect(data.team_id).toBe("team_a");
    expect(data.team_name).toBe("Yankees");
    expect(data.team_color).toBe("#003087");
    expect(data.team_short).toBe("NYY");
    expect(data.leagueId).toBe("sfbl");
    expect(data.timestamp).toBeDefined();
  });

  it("captain_chat writes to /captain_chat (not /team_messages)", async () => {
    mockState.decoded.leagues = { sfbl: "captain:team_a" };
    await POST(
      makeReq({
        leagueId: "sfbl",
        collection: "captain_chat",
        text: "captains-only",
      }),
    );
    const msgWrite = mockState.setCalls.find((c) =>
      c.path.startsWith("leagues/sfbl/captain_chat/"),
    );
    expect(msgWrite).toBeDefined();
    const teamMsgWrite = mockState.setCalls.find((c) =>
      c.path.startsWith("leagues/sfbl/team_messages/"),
    );
    expect(teamMsgWrite).toBeUndefined();
  });
});

// ── push fan-out ──────────────────────────────────────────────────

describe("/api/chat-message — push fan-out", () => {
  it("team_messages push deep-links to /profile#teamchat (universal)", async () => {
    mockState.decoded.leagues = { sfbl: "captain:team_a" };
    await POST(
      makeReq({
        leagueId: "sfbl",
        collection: "team_messages",
        teamId: "team_a",
        text: "hello team",
      }),
    );
    expect(mockState.fetchCalls).toHaveLength(1);
    const push = mockState.fetchCalls[0]!.body;
    expect(push.url).toBe("/profile#teamchat");
    expect(push.category).toBe("team_chat");
    expect(push.team).toBe("team_a");
  });

  it("captain_chat push deep-links to /captain#captchat", async () => {
    mockState.decoded.leagues = { sfbl: "captain:team_a" };
    await POST(
      makeReq({
        leagueId: "sfbl",
        collection: "captain_chat",
        text: "captains note",
      }),
    );
    const push = mockState.fetchCalls[0]!.body;
    expect(push.url).toBe("/captain#captchat");
    expect(push.category).toBe("captains_chat");
    // No team filter on captain_chat — goes to all captains.
    expect(push.team).toBeUndefined();
  });

  it("forwards senderToken as excludeToken to send-notification", async () => {
    mockState.decoded.leagues = { sfbl: "captain:team_a" };
    await POST(
      makeReq({
        leagueId: "sfbl",
        collection: "team_messages",
        teamId: "team_a",
        text: "hi",
        senderToken: "fcm_token_abc123",
      }),
    );
    const push = mockState.fetchCalls[0]!.body;
    expect(push.excludeToken).toBe("fcm_token_abc123");
  });

  it("omits excludeToken when senderToken not provided", async () => {
    mockState.decoded.leagues = { sfbl: "captain:team_a" };
    await POST(
      makeReq({
        leagueId: "sfbl",
        collection: "team_messages",
        teamId: "team_a",
        text: "hi",
      }),
    );
    const push = mockState.fetchCalls[0]!.body;
    expect(push.excludeToken).toBeUndefined();
  });

  it("truncates push body at 120 chars with ellipsis", async () => {
    mockState.decoded.leagues = { sfbl: "captain:team_a" };
    const longText = "x".repeat(200);
    await POST(
      makeReq({
        leagueId: "sfbl",
        collection: "team_messages",
        teamId: "team_a",
        text: longText,
      }),
    );
    const push = mockState.fetchCalls[0]!.body;
    expect(typeof push.body).toBe("string");
    const pushBody = push.body as string;
    expect(pushBody.length).toBe(121); // 120 + ellipsis char
    expect(pushBody.endsWith("…")).toBe(true);
  });

  it("push failure does NOT fail the chat write", async () => {
    mockState.decoded.leagues = { sfbl: "captain:team_a" };
    mockState.fetchThrows = true;
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        collection: "team_messages",
        teamId: "team_a",
        text: "still saved",
      }),
    );
    expect(res.status).toBe(200);
    // Message still written to Firestore.
    const msgWrite = mockState.setCalls.find((c) =>
      c.path.startsWith("leagues/sfbl/team_messages/"),
    );
    expect(msgWrite).toBeDefined();
  });
});
