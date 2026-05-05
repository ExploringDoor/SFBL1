// Integration test for /api/send-notification — proves the endpoint
// correctly threads body → matcher → FCM send loop.
//
// The unit tests in notification-tenant-isolation.test.ts cover the
// pure filter math (matchTokens). They do NOT cover:
//
//   - Whether the endpoint reads `excludePlayerIds` from the body and
//     hands it to the matcher (typo / wrong field would break silently)
//   - Whether the endpoint actually skips FCM sends for filtered tokens
//     (a future "loop over tokens instead of matched" refactor would
//     pass the unit tests but break in production)
//   - Whether the leagueId filter is enforced at the QUERY level — the
//     endpoint must filter via Firestore `where()` so cross-tenant docs
//     never enter memory
//
// We mock @/lib/firebase-admin so we can:
//   1. Hand the route a controlled set of token docs via Firestore stub
//   2. Spy on messaging.send() to count and inspect calls
//   3. Stub auth.verifyIdToken() with a configurable claim set
//
// Then we import the POST handler directly and call it with a Request.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock layer ─────────────────────────────────────────────────────
// The route imports getAdminAuth/getAdminDb/getAdminMessaging from
// @/lib/firebase-admin. We replace those with controllable fakes.

interface MockTokenDoc {
  id: string;
  data: Record<string, unknown>;
}

const mockState = {
  // What `verifyIdToken` returns. Tests mutate before each call.
  decoded: {
    uid: "uid_caller",
    leagues: { sfbl: "captain:team_a" } as Record<string, string>,
  } as { uid: string; leagues?: Record<string, string> },
  // Tokens the firestore query will return. Tests mutate before each call.
  // We assert that the query selected only the tokens with the matching
  // `leagueId` field — i.e. our stub respects the where() clause the
  // endpoint sends. That proves leagueId filtering happens at the QUERY
  // layer, not just in matchTokens.
  tokens: [] as MockTokenDoc[],
  // Tokens that should make messaging.send() throw. Used for the dead-
  // token prune test.
  failingTokens: new Set<string>(),
  // Captured calls.
  sendCalls: [] as Array<{
    token: string;
    data?: Record<string, string | undefined>;
  }>,
  deleteBatchPaths: [] as string[],
  pushLogEntries: [] as Record<string, unknown>[],
  // Capture pending_nav docs written during fan-out — one per
  // successful (token, push) delivery.
  pendingNavWrites: [] as Record<string, unknown>[],
  lastWhereClause: null as { field: string; op: string; value: unknown } | null,
};

let nextDocId = 0;

vi.mock("@/lib/firebase-admin", () => {
  return {
    getAdminAuth: () => ({
      verifyIdToken: vi.fn(async () => mockState.decoded),
    }),
    getAdminDb: () => {
      // Build a Firestore-shaped fake. The route only uses .collection().where().get()
      // and .batch().delete().commit() on this object.
      return {
        collection: (name: string) => {
          // /push_log .add()
          if (name === "push_log") {
            return {
              add: async (entry: Record<string, unknown>) => {
                mockState.pushLogEntries.push(entry);
              },
            };
          }
          // /pending_nav — supports .doc() for pre-allocating refs
          // batch.set() will write into.
          if (name === "pending_nav") {
            return {
              doc: () => {
                const id = `pending_${++nextDocId}`;
                return { _path: `pending_nav/${id}`, _coll: "pending_nav" };
              },
            };
          }
          // /notification_tokens .where(leagueId,==,X).get()
          return {
            where: (field: string, op: string, value: unknown) => {
              mockState.lastWhereClause = { field, op, value };
              return {
                get: async () => {
                  // Honour the where() clause — only return tokens whose
                  // leagueId matches. This proves the endpoint's query
                  // is the real isolation layer; if it dropped the
                  // where(), the test would catch it because we'd
                  // include cross-tenant tokens.
                  const filtered = mockState.tokens.filter((t) => {
                    if (field === "leagueId") {
                      return t.data.leagueId === value;
                    }
                    return true;
                  });
                  return {
                    docs: filtered.map((t) => ({
                      id: t.id,
                      data: () => t.data,
                    })),
                  };
                },
              };
            },
          };
        },
        doc: (path: string) => ({
          // for batch.delete()
          _path: path,
        }),
        batch: () => {
          const deletes: string[] = [];
          const sets: Array<{ path: string; data: Record<string, unknown> }> =
            [];
          return {
            delete: (ref: { _path?: string }) => {
              if (ref._path) deletes.push(ref._path);
            },
            set: (
              ref: { _path?: string; _coll?: string },
              data: Record<string, unknown>,
            ) => {
              if (ref._path) sets.push({ path: ref._path, data });
            },
            commit: async () => {
              mockState.deleteBatchPaths.push(...deletes);
              for (const s of sets) {
                if (s.path.startsWith("pending_nav/")) {
                  mockState.pendingNavWrites.push(s.data);
                }
              }
            },
          };
        },
      };
    },
    getAdminMessaging: () => ({
      send: vi.fn(
        async (msg: {
          token: string;
          data?: Record<string, string | undefined>;
        }) => {
          mockState.sendCalls.push({ token: msg.token, data: msg.data });
          if (mockState.failingTokens.has(msg.token)) {
            throw new Error(
              "messaging/registration-token-not-registered: dead token",
            );
          }
        },
      ),
    }),
  };
});

// Have to import after vi.mock so the mocks are wired.
const { POST } = await import(
  "@/app/api/send-notification/route"
);

// ── Helpers ────────────────────────────────────────────────────────

function makeReq(body: Record<string, unknown>): Request {
  return new Request("http://test/api/send-notification", {
    method: "POST",
    headers: {
      authorization: "Bearer fake-token",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function makeTokenDoc(
  id: string,
  data: Partial<{
    token: string;
    leagueId: string;
    categories: string[];
    teams: string[];
    authed_teams: string[];
    is_captain_authed: boolean;
    is_admin: boolean;
    player_id: string | null;
    auth_uid: string;
  }>,
): MockTokenDoc {
  return {
    id,
    data: {
      token: data.token ?? id,
      leagueId: data.leagueId ?? "sfbl",
      categories: data.categories ?? ["scores"],
      teams: data.teams ?? [],
      authed_teams: data.authed_teams ?? [],
      is_captain_authed: data.is_captain_authed ?? false,
      is_admin: data.is_admin ?? false,
      player_id: data.player_id ?? null,
      auth_uid: data.auth_uid ?? "uid_owner",
    },
  };
}

beforeEach(() => {
  mockState.decoded = {
    uid: "uid_caller",
    leagues: { sfbl: "captain:team_a" },
  };
  mockState.tokens = [];
  mockState.failingTokens = new Set();
  mockState.sendCalls = [];
  mockState.deleteBatchPaths = [];
  mockState.pushLogEntries = [];
  mockState.pendingNavWrites = [];
  mockState.lastWhereClause = null;
});

afterEach(() => {
  vi.clearAllMocks();
});

// ── The actual fan-out tests ───────────────────────────────────────

describe("/api/send-notification — fan-out call counts", () => {
  it("calls messaging.send() exactly N times for N matched tokens (baseline)", async () => {
    mockState.tokens = [
      makeTokenDoc("d1", { token: "tok1", categories: [] }),
      makeTokenDoc("d2", { token: "tok2", categories: [] }),
      makeTokenDoc("d3", { token: "tok3", categories: [] }),
    ];
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        title: "T",
        body: "B",
        category: "scores",
      }),
    );
    expect(res.status).toBe(200);
    expect(mockState.sendCalls).toHaveLength(3);
    expect(mockState.sendCalls.map((c) => c.token).sort()).toEqual([
      "tok1",
      "tok2",
      "tok3",
    ]);
  });

  it("excludePlayerIds reduces FCM call count — sends to 3 tokens, not 5", async () => {
    // 5 tokens, 2 of them have player_id in excludePlayerIds. Expect 3
    // FCM sends. This is the test that proves the endpoint actually
    // honours excludePlayerIds — not just that the body field reaches
    // the matcher.
    mockState.tokens = [
      makeTokenDoc("d1", { token: "tok1", player_id: "p1" }),
      makeTokenDoc("d2", { token: "tok2", player_id: "p2" }),
      makeTokenDoc("d3", { token: "tok3", player_id: "p3" }),
      makeTokenDoc("d4", { token: "tok4", player_id: "p4" }),
      makeTokenDoc("d5", { token: "tok5", player_id: "p5" }),
    ];
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        title: "T",
        body: "B",
        category: "scores",
        excludePlayerIds: ["p2", "p4"],
      }),
    );
    expect(res.status).toBe(200);
    expect(mockState.sendCalls).toHaveLength(3);
    const tokensSent = new Set(mockState.sendCalls.map((c) => c.token));
    expect(tokensSent).toEqual(new Set(["tok1", "tok3", "tok5"]));
    // Sanity — the response counts agree.
    const json = (await res.json()) as { sent: number; total: number };
    expect(json.sent).toBe(3);
    expect(json.total).toBe(3);
  });

  it("excludeToken suppresses sender's own device", async () => {
    mockState.tokens = [
      makeTokenDoc("d1", { token: "self-device" }),
      makeTokenDoc("d2", { token: "other-device" }),
    ];
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        title: "T",
        body: "B",
        category: "scores",
        excludeToken: "self-device",
      }),
    );
    expect(res.status).toBe(200);
    expect(mockState.sendCalls).toHaveLength(1);
    expect(mockState.sendCalls[0]!.token).toBe("other-device");
  });

  it("category prefs filter — non-empty categories without our category drops the token", async () => {
    mockState.tokens = [
      makeTokenDoc("d1", { token: "tok-subscribed", categories: ["scores"] }),
      makeTokenDoc("d2", {
        token: "tok-not-subscribed",
        categories: ["rainouts"],
      }),
      makeTokenDoc("d3", { token: "tok-empty-cats", categories: [] }), // empty = subscribe-to-all
    ];
    await POST(
      makeReq({
        leagueId: "sfbl",
        title: "T",
        body: "B",
        category: "scores",
      }),
    );
    const tokens = mockState.sendCalls.map((c) => c.token).sort();
    expect(tokens).toEqual(["tok-empty-cats", "tok-subscribed"]);
  });

  it("adminOnly bypasses category prefs but requires is_admin", async () => {
    mockState.tokens = [
      makeTokenDoc("d1", {
        token: "non-admin",
        is_admin: false,
        categories: ["scores"],
      }),
      makeTokenDoc("d2", {
        token: "admin-no-admin-cat",
        is_admin: true,
        categories: ["scores"], // no 'admin' in their list
      }),
      makeTokenDoc("d3", {
        token: "admin-with-admin-cat",
        is_admin: true,
        categories: ["scores", "admin"],
      }),
    ];
    await POST(
      makeReq({
        leagueId: "sfbl",
        title: "T",
        body: "B",
        category: "admin",
        adminOnly: true,
      }),
    );
    // Both admins should receive (adminOnly bypasses the cat check).
    const tokens = mockState.sendCalls.map((c) => c.token).sort();
    expect(tokens).toEqual(["admin-no-admin-cat", "admin-with-admin-cat"]);
  });

  it("team_chat requires authed_teams overlap (not subscription teams)", async () => {
    mockState.tokens = [
      makeTokenDoc("d1", {
        token: "subscriber-not-rostered",
        categories: ["team_chat"],
        teams: ["team_a"], // subscribed but NOT rostered
        authed_teams: ["team_b"],
      }),
      makeTokenDoc("d2", {
        token: "rostered",
        categories: ["team_chat"],
        teams: [], // subscribes to all, but the team_chat branch ignores `teams`
        authed_teams: ["team_a"],
      }),
    ];
    await POST(
      makeReq({
        leagueId: "sfbl",
        title: "Team chat msg",
        body: "Hi team",
        category: "team_chat",
        team: "team_a",
      }),
    );
    expect(mockState.sendCalls).toHaveLength(1);
    expect(mockState.sendCalls[0]!.token).toBe("rostered");
  });

  it("captains_chat requires is_captain_authed; ignores team filter", async () => {
    mockState.tokens = [
      makeTokenDoc("d1", {
        token: "non-captain",
        categories: ["captains_chat"],
        is_captain_authed: false,
      }),
      makeTokenDoc("d2", {
        token: "captain-other-team",
        categories: ["captains_chat"],
        is_captain_authed: true,
        authed_teams: ["team_b"], // shouldn't matter — captains_chat is league-wide
      }),
    ];
    await POST(
      makeReq({
        leagueId: "sfbl",
        title: "Captains msg",
        body: "Hi captains",
        category: "captains_chat",
        team: "team_a",
      }),
    );
    expect(mockState.sendCalls).toHaveLength(1);
    expect(mockState.sendCalls[0]!.token).toBe("captain-other-team");
  });
});

describe("/api/send-notification — leagueId enforcement at query layer", () => {
  it("issues `where('leagueId','==', leagueId)` BEFORE any other filter", async () => {
    mockState.tokens = [
      makeTokenDoc("d1", { token: "sfbl1", leagueId: "sfbl" }),
      makeTokenDoc("d2", { token: "kcsl1", leagueId: "kcsl" }),
    ];
    await POST(
      makeReq({
        leagueId: "sfbl",
        title: "T",
        body: "B",
        category: "scores",
      }),
    );
    expect(mockState.lastWhereClause).toEqual({
      field: "leagueId",
      op: "==",
      value: "sfbl",
    });
    // KCSL token must NOT enter memory (the query stub respects the
    // where clause — see comment at top of mock). Send should only fire
    // for sfbl1.
    expect(mockState.sendCalls).toHaveLength(1);
    expect(mockState.sendCalls[0]!.token).toBe("sfbl1");
  });

  it("rejects callers with no role in the target league (403)", async () => {
    mockState.decoded = {
      uid: "uid_outsider",
      leagues: { kcsl: "captain:team_b" }, // not in sfbl
    };
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        title: "T",
        body: "B",
        category: "scores",
      }),
    );
    expect(res.status).toBe(403);
    expect(mockState.sendCalls).toHaveLength(0);
  });
});

describe("/api/send-notification — dead-token prune", () => {
  it("prunes a dead token via batched delete after FCM error", async () => {
    mockState.tokens = [
      makeTokenDoc("d1", { token: "live", categories: [] }),
      makeTokenDoc("d2-dead", { token: "dead", categories: [] }),
    ];
    mockState.failingTokens.add("dead");
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        title: "T",
        body: "B",
        category: "scores",
      }),
    );
    expect(res.status).toBe(200);
    // Both attempts hit FCM (we count attempts, not successes).
    expect(mockState.sendCalls).toHaveLength(2);
    // The dead one's docId got batched for deletion.
    expect(mockState.deleteBatchPaths).toEqual([
      "notification_tokens/d2-dead",
    ]);
    const json = (await res.json()) as {
      sent: number;
      failed: number;
      pruned: number;
    };
    expect(json.sent).toBe(1);
    expect(json.failed).toBe(1);
    expect(json.pruned).toBe(1);
  });
});

describe("/api/send-notification — payload shape", () => {
  it("sends data-only payload (no top-level notification block)", async () => {
    mockState.tokens = [
      makeTokenDoc("d1", { token: "tok1", categories: [] }),
    ];
    await POST(
      makeReq({
        leagueId: "sfbl",
        title: "Test title",
        body: "Test body",
        category: "scores",
        url: "/captain#scores",
        sourceId: "msg_42",
      }),
    );
    expect(mockState.sendCalls).toHaveLength(1);
    const call = mockState.sendCalls[0]!;
    // title + body live in `data`, not at top-level. iOS PWA depends
    // on this — DVSL spec §1 lines 200-216.
    expect(call.data).toMatchObject({
      title: "Test title",
      body: "Test body",
      leagueId: "sfbl",
      category: "scores",
      url: "/captain#scores",
      sourceId: "msg_42",
    });
  });
});

describe("/api/send-notification — pending_nav (notification bell)", () => {
  it("writes one pending_nav doc per successful FCM delivery", async () => {
    mockState.tokens = [
      makeTokenDoc("d1", {
        token: "tok1",
        auth_uid: "uid_alice",
        categories: [],
      }),
      makeTokenDoc("d2", {
        token: "tok2",
        auth_uid: "uid_bob",
        categories: [],
      }),
      makeTokenDoc("d3", {
        token: "tok3",
        auth_uid: "uid_carol",
        categories: [],
      }),
    ];
    await POST(
      makeReq({
        leagueId: "sfbl",
        title: "Game final",
        body: "Yankees 5, Red Sox 3",
        category: "scores",
        url: "/games/g1",
      }),
    );
    expect(mockState.pendingNavWrites).toHaveLength(3);
    const aliceDoc = mockState.pendingNavWrites.find(
      (d) => d.token === "tok1",
    );
    expect(aliceDoc).toMatchObject({
      token: "tok1",
      auth_uid: "uid_alice",
      leagueId: "sfbl",
      title: "Game final",
      body: "Yankees 5, Red Sox 3",
      url: "/games/g1",
      category: "scores",
      dismissed_at: null,
    });
  });

  it("does NOT write pending_nav for failed sends", async () => {
    mockState.tokens = [
      makeTokenDoc("d1", { token: "live", categories: [] }),
      makeTokenDoc("d2-dead", { token: "dead", categories: [] }),
    ];
    mockState.failingTokens.add("dead");
    await POST(
      makeReq({
        leagueId: "sfbl",
        title: "T",
        body: "B",
        category: "scores",
      }),
    );
    expect(mockState.pendingNavWrites).toHaveLength(1);
    expect(mockState.pendingNavWrites[0]!.token).toBe("live");
  });

  it("does NOT write pending_nav when 0 tokens match the filter", async () => {
    mockState.tokens = [
      makeTokenDoc("d1", {
        token: "tok1",
        categories: ["rainouts"], // not subscribed to scores
      }),
    ];
    await POST(
      makeReq({
        leagueId: "sfbl",
        title: "T",
        body: "B",
        category: "scores",
      }),
    );
    expect(mockState.sendCalls).toHaveLength(0);
    expect(mockState.pendingNavWrites).toHaveLength(0);
  });

  it("scopes pending_nav by leagueId from the payload", async () => {
    mockState.tokens = [
      makeTokenDoc("d1", {
        token: "tok1",
        leagueId: "sfbl",
        auth_uid: "uid_alice",
        categories: [],
      }),
    ];
    await POST(
      makeReq({
        leagueId: "sfbl",
        title: "T",
        body: "B",
        category: "scores",
      }),
    );
    expect(mockState.pendingNavWrites).toHaveLength(1);
    expect(mockState.pendingNavWrites[0]!.leagueId).toBe("sfbl");
  });
});
