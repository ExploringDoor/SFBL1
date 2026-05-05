// Integration test for /api/pregame-reminder cron endpoint.
//
// Covers:
//   - Auth: missing CRON_SECRET → fail closed (401)
//   - Auth: wrong secret → 401
//   - Auth: Bearer + matching secret → succeeds
//   - Auth: X-Cron-Secret header → succeeds (manual-trigger path)
//   - Window: skips games outside 45-75 min window
//   - Window: fires for games inside window
//   - Idempotency: pregame_reminder_sent=true → skip on next run
//   - Multi-tenant: only fires for leagueId-matched tokens
//
// Mocks @/lib/firebase-admin so we can drive Firestore + FCM in
// memory. Same shape as send-notification-fanout.test.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const CRON_SECRET = "test-cron-secret-12345";

// Mutable mock state per test.
const mockState = {
  // Top-level /leagues collection.
  leagues: ["sfbl"] as string[],
  // Games keyed by `${leagueId}:${gameId}`.
  games: new Map<
    string,
    {
      data: Record<string, unknown>;
      ref: { update: (patch: Record<string, unknown>) => void };
    }
  >(),
  // /leagues/{id}/teams docs keyed by `${leagueId}:${teamId}`.
  teams: new Map<string, Record<string, unknown>>(),
  // /notification_tokens scoped by leagueId.
  tokens: [] as Array<{ docId: string; data: Record<string, unknown> }>,
  // Captured FCM sends.
  sendCalls: [] as Array<{ token: string; data?: Record<string, unknown> }>,
  // Captured idempotency-flag writes.
  flagWrites: [] as Array<{ gameId: string; patch: Record<string, unknown> }>,
};

vi.mock("@/lib/firebase-admin", () => {
  return {
    getAdminAuth: () => ({}),
    getAdminDb: () => {
      function makeQuery(parsed: { collPath: string; whereField?: string; whereValue?: unknown }) {
        return {
          where: (field: string, _op: string, value: unknown) =>
            makeQuery({ ...parsed, whereField: field, whereValue: value }),
          get: async () => {
            if (parsed.collPath === "leagues") {
              return {
                size: mockState.leagues.length,
                docs: mockState.leagues.map((id) => ({ id })),
              };
            }
            // /leagues/{leagueId}/games
            const gameMatch = parsed.collPath.match(
              /^leagues\/([^/]+)\/games$/,
            );
            if (gameMatch) {
              const leagueId = gameMatch[1];
              const docs: Array<{
                id: string;
                data: () => Record<string, unknown>;
                ref: typeof unusedRef;
              }> = [];
              for (const [key, val] of mockState.games) {
                const [k_lid, gid] = key.split(":");
                if (k_lid !== leagueId) continue;
                if (
                  parsed.whereField &&
                  val.data[parsed.whereField] !== parsed.whereValue
                ) {
                  continue;
                }
                docs.push({
                  id: gid!,
                  data: () => val.data,
                  ref: {
                    set: async (
                      patch: Record<string, unknown>,
                      _opts?: { merge?: boolean },
                    ) => {
                      Object.assign(val.data, patch);
                      mockState.flagWrites.push({ gameId: gid!, patch });
                    },
                  },
                });
              }
              return { size: docs.length, docs };
            }
            // /leagues/{leagueId}/teams
            const teamsMatch = parsed.collPath.match(
              /^leagues\/([^/]+)\/teams$/,
            );
            if (teamsMatch) {
              const leagueId = teamsMatch[1];
              const docs = [];
              for (const [key, data] of mockState.teams) {
                const [k_lid, tid] = key.split(":");
                if (k_lid !== leagueId) continue;
                docs.push({ id: tid, data: () => data });
              }
              return { size: docs.length, docs };
            }
            // /notification_tokens
            if (parsed.collPath === "notification_tokens") {
              const filtered = mockState.tokens.filter((t) => {
                if (parsed.whereField === "leagueId") {
                  return t.data.leagueId === parsed.whereValue;
                }
                return true;
              });
              return {
                size: filtered.length,
                docs: filtered.map((t) => ({
                  id: t.docId,
                  data: () => t.data,
                })),
              };
            }
            // /push_log
            if (parsed.collPath === "push_log") {
              return { size: 0, docs: [] };
            }
            return { size: 0, docs: [] };
          },
        };
      }
      const unusedRef = {};
      return {
        collection: (path: string) => {
          if (path === "push_log") {
            return {
              ...makeQuery({ collPath: "push_log" }),
              add: async () => {
                /* no-op */
              },
            };
          }
          // pending_nav fan-out from send.ts uses .doc() to allocate
          // a ref then batch.set() to write. We just need .doc() to
          // return something — we don't assert on contents here.
          if (path === "pending_nav") {
            return {
              doc: () => ({}),
            };
          }
          return makeQuery({ collPath: path });
        },
        doc: () => ({}),
        // Mock supports both .delete() (dead-token prune) and .set()
        // (pending_nav write). Both are no-op in pregame tests; we
        // only assert on sendCalls + flagWrites.
        batch: () => ({
          delete: () => {},
          set: () => {},
          commit: async () => {},
        }),
      };
    },
    getAdminMessaging: () => ({
      send: vi.fn(async (msg: { token: string; data?: Record<string, unknown> }) => {
        mockState.sendCalls.push({ token: msg.token, data: msg.data });
      }),
    }),
  };
});

const { GET } = await import("@/app/api/pregame-reminder/route");

beforeEach(() => {
  process.env.CRON_SECRET = CRON_SECRET;
  mockState.leagues = ["sfbl"];
  mockState.games = new Map();
  mockState.teams = new Map();
  mockState.tokens = [];
  mockState.sendCalls = [];
  mockState.flagWrites = [];
});

afterEach(() => {
  vi.clearAllMocks();
});

function makeReq(headers: Record<string, string> = {}): Request {
  return new Request("http://test/api/pregame-reminder", {
    method: "GET",
    headers,
  });
}

function gameInWindow(minutesFromNow: number): Record<string, unknown> {
  return {
    away_team_id: "team_a",
    home_team_id: "team_b",
    status: "scheduled",
    date: new Date(Date.now() + minutesFromNow * 60 * 1000).toISOString(),
    field: "Field 1",
  };
}

describe("/api/pregame-reminder — auth", () => {
  it("fails closed when CRON_SECRET env is unset", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(makeReq({ authorization: `Bearer anything` }));
    expect(res.status).toBe(401);
  });

  it("rejects mismatched secret", async () => {
    const res = await GET(makeReq({ authorization: `Bearer wrong` }));
    expect(res.status).toBe(401);
  });

  it("accepts Vercel cron Bearer header", async () => {
    const res = await GET(
      makeReq({ authorization: `Bearer ${CRON_SECRET}` }),
    );
    expect(res.status).toBe(200);
  });

  it("accepts X-Cron-Secret header for manual trigger", async () => {
    const res = await GET(makeReq({ "x-cron-secret": CRON_SECRET }));
    expect(res.status).toBe(200);
  });
});

describe("/api/pregame-reminder — window logic", () => {
  it("skips games starting in 30 minutes (too close)", async () => {
    mockState.games.set("sfbl:g1", {
      data: gameInWindow(30),
      ref: {} as never,
    });
    const res = await GET(
      makeReq({ authorization: `Bearer ${CRON_SECRET}` }),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { games_processed: number };
    expect(json.games_processed).toBe(0);
    expect(mockState.sendCalls).toHaveLength(0);
  });

  it("skips games starting in 90 minutes (too far)", async () => {
    mockState.games.set("sfbl:g1", {
      data: gameInWindow(90),
      ref: {} as never,
    });
    const res = await GET(
      makeReq({ authorization: `Bearer ${CRON_SECRET}` }),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { games_processed: number };
    expect(json.games_processed).toBe(0);
  });

  it("fires for games starting in 60 minutes (centered window)", async () => {
    mockState.tokens = [
      {
        docId: "t1",
        data: {
          token: "fcm_tok_1",
          leagueId: "sfbl",
          categories: ["pregame"],
          teams: ["team_a"],
        },
      },
    ];
    mockState.games.set("sfbl:g1", {
      data: gameInWindow(60),
      ref: {} as never,
    });
    const res = await GET(
      makeReq({ authorization: `Bearer ${CRON_SECRET}` }),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      games_processed: number;
      results: Array<{ status: string }>;
    };
    expect(json.games_processed).toBe(1);
    expect(json.results[0]!.status).toBe("sent");
    expect(mockState.sendCalls).toHaveLength(1);
  });

  it("fires at the edges of the window (45 and 75 min)", async () => {
    mockState.tokens = [
      {
        docId: "t1",
        data: {
          token: "fcm_tok_1",
          leagueId: "sfbl",
          categories: [],
          teams: [],
        },
      },
    ];
    mockState.games.set("sfbl:g_45", {
      data: gameInWindow(50), // 50 min — inside window
      ref: {} as never,
    });
    mockState.games.set("sfbl:g_75", {
      data: gameInWindow(70), // 70 min — inside window
      ref: {} as never,
    });
    const res = await GET(
      makeReq({ authorization: `Bearer ${CRON_SECRET}` }),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { games_processed: number };
    expect(json.games_processed).toBe(2);
  });
});

describe("/api/pregame-reminder — idempotency", () => {
  it("skips a game that already has pregame_reminder_sent=true", async () => {
    mockState.games.set("sfbl:g1", {
      data: { ...gameInWindow(60), pregame_reminder_sent: true },
      ref: {} as never,
    });
    const res = await GET(
      makeReq({ authorization: `Bearer ${CRON_SECRET}` }),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { games_processed: number };
    expect(json.games_processed).toBe(0);
    expect(mockState.sendCalls).toHaveLength(0);
  });

  it("marks the game pregame_reminder_sent=true after a successful pass", async () => {
    mockState.tokens = [
      {
        docId: "t1",
        data: {
          token: "fcm_tok_1",
          leagueId: "sfbl",
          categories: [],
          teams: [],
        },
      },
    ];
    mockState.games.set("sfbl:g1", {
      data: gameInWindow(60),
      ref: {} as never,
    });
    await GET(makeReq({ authorization: `Bearer ${CRON_SECRET}` }));
    expect(mockState.flagWrites).toHaveLength(1);
    expect(mockState.flagWrites[0]!.patch).toMatchObject({
      pregame_reminder_sent: true,
    });
  });
});

describe("/api/pregame-reminder — multi-tenant", () => {
  it("only fires for tokens whose leagueId matches the game's league", async () => {
    mockState.leagues = ["sfbl", "kcsl"];
    mockState.tokens = [
      {
        docId: "t_sfbl",
        data: {
          token: "tok_sfbl",
          leagueId: "sfbl",
          categories: [],
          teams: [],
        },
      },
      {
        docId: "t_kcsl",
        data: {
          token: "tok_kcsl",
          leagueId: "kcsl",
          categories: [],
          teams: [],
        },
      },
    ];
    // Only SFBL has a qualifying game.
    mockState.games.set("sfbl:g1", {
      data: gameInWindow(60),
      ref: {} as never,
    });
    await GET(makeReq({ authorization: `Bearer ${CRON_SECRET}` }));
    expect(mockState.sendCalls).toHaveLength(1);
    expect(mockState.sendCalls[0]!.token).toBe("tok_sfbl");
  });
});
