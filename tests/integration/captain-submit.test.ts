// Integration tests for /api/captain-submit — the highest-stakes
// endpoint on the platform. This is the path where:
//   1. Captain's private submission gets promoted to public /box_scores
//   2. game.status flips to "final" when both sides have scores
//   3. recalcLeague refreshes per-player season aggregates
//   4. push triggers fire for score-submitted / final / score-conflict
//
// A bug here means: standings drift, stats don't update, pushes don't
// fire, captains report "I submitted, why isn't it showing?". Before
// this test we relied on the captain-score-only emulator test for
// data shape only. This adds full endpoint coverage including the
// trigger logic.
//
// Mocks @/lib/firebase-admin, @/lib/stats (recalcLeague), and
// @/lib/notifications/server-fanout so the test runs in-memory.
// Uses the response body to verify ok:true + recalc result, plus the
// captured Firestore writes + fanout calls to verify side effects.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface DocState {
  data: Record<string, unknown>;
}

const mockState = {
  decoded: {
    uid: "uid_captain",
    leagues: { sfbl: "captain:team_a" } as Record<string, string>,
  } as { uid: string; leagues?: Record<string, string> },
  // Firestore docs keyed by full path.
  docs: new Map<string, DocState>(),
  // Captured set/merge writes.
  setCalls: [] as Array<{
    path: string;
    data: Record<string, unknown>;
    merge: boolean;
  }>,
  // Captured collection.get() results — populated from docs map by
  // path-prefix match on the leagues/{id}/teams collection.
  // Captured fanoutPush calls.
  fanoutCalls: [] as Array<{
    category: string;
    title: string;
    body: string;
    teams?: string[];
    adminOnly?: boolean;
    url?: string;
  }>,
  // Captured recalcLeague calls.
  recalcCalls: [] as Array<{ leagueId: string }>,
  // Failure-mode toggles — flipped per-test to simulate broken
  // dependencies (token verification, recalcLeague).
  verifyThrows: false,
  recalcThrows: false,
};

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
      set: async (
        data: Record<string, unknown>,
        opts?: { merge?: boolean },
      ) => {
        const merge = opts?.merge === true;
        mockState.setCalls.push({ path, data, merge });
        const existing = mockState.docs.get(path)?.data ?? {};
        mockState.docs.set(path, {
          data: merge ? { ...existing, ...data } : data,
        });
      },
    }),
    collection: (path: string) => ({
      get: async () => {
        // Match all docs whose path is `{path}/{id}`.
        const docs: Array<{ id: string; data: () => Record<string, unknown> }> =
          [];
        for (const [docPath, state] of mockState.docs) {
          if (
            docPath.startsWith(path + "/") &&
            !docPath.slice(path.length + 1).includes("/")
          ) {
            const id = docPath.slice(path.length + 1);
            docs.push({ id, data: () => state.data });
          }
        }
        return { docs };
      },
    }),
  }),
  getAdminMessaging: () => ({}),
}));

vi.mock("@/lib/stats", () => ({
  recalcLeague: vi.fn(async (_db: unknown, leagueId: string) => {
    mockState.recalcCalls.push({ leagueId });
    if (mockState.recalcThrows) throw new Error("aggregate failed");
    return {
      box_scores_read: 1,
      players_aggregated: 0,
      players_written: 0,
      pitchers_written: 0,
      duration_ms: 1,
    };
  }),
}));

vi.mock("@/lib/notifications/server-fanout", () => ({
  fanoutPush: vi.fn(
    async (opts: {
      category: string;
      title: string;
      body: string;
      teams?: string[];
      adminOnly?: boolean;
      url?: string;
    }) => {
      mockState.fanoutCalls.push({
        category: opts.category,
        title: opts.title,
        body: opts.body,
        teams: opts.teams,
        adminOnly: opts.adminOnly,
        url: opts.url,
      });
    },
  ),
  originFromRequest: () => "http://test",
}));

const { POST } = await import("@/app/api/captain-submit/route");

function makeReq(body: Record<string, unknown>): Request {
  return new Request("http://test/api/captain-submit", {
    method: "POST",
    headers: {
      authorization: "Bearer fake",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function setDoc(path: string, data: Record<string, unknown>) {
  mockState.docs.set(path, { data });
}

beforeEach(() => {
  mockState.decoded = {
    uid: "uid_captain",
    leagues: { sfbl: "captain:team_a" },
  };
  mockState.docs = new Map();
  mockState.setCalls = [];
  mockState.fanoutCalls = [];
  mockState.recalcCalls = [];
  mockState.verifyThrows = false;
  mockState.recalcThrows = false;

  // Default fixture: 1 game between team_a and team_b. Both teams
  // exist in /teams. Tests can override or add more docs as needed.
  setDoc("leagues/sfbl/games/g1", {
    home_team_id: "team_b",
    away_team_id: "team_a",
    status: "scheduled",
    week: 5,
    date: "2026-05-10T18:00:00",
  });
  setDoc("leagues/sfbl/teams/team_a", { name: "Yankees" });
  setDoc("leagues/sfbl/teams/team_b", { name: "Red Sox" });
});

afterEach(() => vi.clearAllMocks());

describe("/api/captain-submit — auth + body", () => {
  it("rejects missing bearer", async () => {
    const req = new Request("http://test/api/captain-submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ leagueId: "sfbl", gameId: "g1" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("rejects callers with no league claim", async () => {
    mockState.decoded.leagues = {};
    const res = await POST(
      makeReq({ leagueId: "sfbl", gameId: "g1" }),
    );
    expect(res.status).toBe(403);
  });

  it("rejects callers with player claim only (not captain or admin)", async () => {
    mockState.decoded.leagues = { sfbl: "player:p1" };
    const res = await POST(
      makeReq({ leagueId: "sfbl", gameId: "g1" }),
    );
    expect(res.status).toBe(403);
  });

  it("404s when no submission lane exists for the captain", async () => {
    // Captain claim is captain:team_a — but no
    // /box_score_submissions/g1_team_a exists.
    const res = await POST(
      makeReq({ leagueId: "sfbl", gameId: "g1" }),
    );
    expect(res.status).toBe(404);
  });
});

describe("/api/captain-submit — first-captain promotion (awaiting other)", () => {
  it("writes captain's side to /box_scores + flips game.away_score; game stays scheduled", async () => {
    setDoc("leagues/sfbl/box_score_submissions/g1_team_a", {
      game_id: "g1",
      team_id: "team_a",
      side: "away",
      lineup: [
        { player_id: "p1", ab: 4, h: 2, hr: 1, rbi: 3, r: 2 },
      ],
      pitchers: [],
      linescore: [0, 1, 0, 0, 0, 0, 2, 0, 1],
      hits: 8,
      errors: 1,
      score: 7,
    });
    const res = await POST(
      makeReq({ leagueId: "sfbl", gameId: "g1" }),
    );
    expect(res.status).toBe(200);
    // Check /box_scores got the away side written.
    const boxWrite = mockState.setCalls.find(
      (c) => c.path === "leagues/sfbl/box_scores/g1",
    );
    expect(boxWrite).toBeDefined();
    expect(boxWrite!.data.away_score).toBe(7);
    expect((boxWrite!.data.away_lineup as unknown[]).length).toBe(1);
    expect(boxWrite!.data.away_score_only).toBe(false);

    // Game doc gets away_score promoted, but status stays "scheduled"
    // because home_score isn't set yet.
    const gameWrite = mockState.setCalls.find(
      (c) => c.path === "leagues/sfbl/games/g1",
    );
    expect(gameWrite).toBeDefined();
    expect(gameWrite!.data.away_score).toBe(7);
    expect(gameWrite!.data.status).toBeUndefined(); // not set → stays scheduled
  });

  it("fires score-submitted push (not final) when only one side is in", async () => {
    setDoc("leagues/sfbl/box_score_submissions/g1_team_a", {
      game_id: "g1",
      team_id: "team_a",
      side: "away",
      lineup: [{ player_id: "p1", ab: 4, h: 2 }],
      score: 7,
    });
    await POST(makeReq({ leagueId: "sfbl", gameId: "g1" }));
    expect(mockState.fanoutCalls).toHaveLength(1);
    const push = mockState.fanoutCalls[0]!;
    expect(push.category).toBe("scores");
    expect(push.title).toContain("Score submitted");
    // Both teams included in the audience filter.
    expect(push.teams).toEqual(["team_a", "team_b"]);
    expect(push.adminOnly).toBeUndefined();
  });

  it("calls recalcLeague after every submit", async () => {
    setDoc("leagues/sfbl/box_score_submissions/g1_team_a", {
      game_id: "g1",
      team_id: "team_a",
      side: "away",
      lineup: [{ player_id: "p1", ab: 4, h: 2 }],
      score: 7,
    });
    await POST(makeReq({ leagueId: "sfbl", gameId: "g1" }));
    expect(mockState.recalcCalls).toHaveLength(1);
    expect(mockState.recalcCalls[0]!.leagueId).toBe("sfbl");
  });
});

describe("/api/captain-submit — second-captain promotion (game flips final)", () => {
  it("flips game.status to 'final' when other side already has a score", async () => {
    // Pre-existing public box-score doc with the away side already filled.
    setDoc("leagues/sfbl/box_scores/g1", {
      away_score: 7,
      away_lineup: [{ player_id: "p1", ab: 4 }],
    });
    // Now home captain submits.
    mockState.decoded.leagues = { sfbl: "captain:team_b" };
    setDoc("leagues/sfbl/box_score_submissions/g1_team_b", {
      game_id: "g1",
      team_id: "team_b",
      side: "home",
      lineup: [{ player_id: "p2", ab: 4, h: 1 }],
      score: 5,
    });
    const res = await POST(
      makeReq({ leagueId: "sfbl", gameId: "g1" }),
    );
    expect(res.status).toBe(200);
    const gameWrite = mockState.setCalls.find(
      (c) => c.path === "leagues/sfbl/games/g1",
    );
    expect(gameWrite!.data.status).toBe("final");
    expect(gameWrite!.data.home_score).toBe(5);
    expect(gameWrite!.data.away_score).toBe(7);
  });

  it("fires final score push (not score-submitted)", async () => {
    setDoc("leagues/sfbl/box_scores/g1", {
      away_score: 7,
    });
    mockState.decoded.leagues = { sfbl: "captain:team_b" };
    setDoc("leagues/sfbl/box_score_submissions/g1_team_b", {
      game_id: "g1",
      team_id: "team_b",
      side: "home",
      lineup: [{ player_id: "p2", ab: 3, h: 1 }],
      score: 5,
    });
    await POST(makeReq({ leagueId: "sfbl", gameId: "g1" }));
    const finalPush = mockState.fanoutCalls.find(
      (c) => c.title.startsWith("Final:"),
    );
    expect(finalPush).toBeDefined();
    expect(finalPush!.category).toBe("scores");
    expect(finalPush!.title).toContain("Yankees 7");
    expect(finalPush!.title).toContain("Red Sox 5");
    expect(finalPush!.url).toBe("/games/g1");
  });
});

describe("/api/captain-submit — score conflict alert", () => {
  it("fires admin-only conflict push when captain's opp_final_score disagrees with existing", async () => {
    // Existing /box_scores has home_score=5 (set by home captain).
    setDoc("leagues/sfbl/box_scores/g1", { home_score: 5 });
    // Away captain submits with their view of opp = 6 (disagreement).
    setDoc("leagues/sfbl/box_score_submissions/g1_team_a", {
      game_id: "g1",
      team_id: "team_a",
      side: "away",
      lineup: [{ player_id: "p1", ab: 4 }],
      score: 7,
      opp_side: "home",
      opp_final_score: 6, // disagrees with existing 5
    });
    await POST(makeReq({ leagueId: "sfbl", gameId: "g1" }));
    const conflictPush = mockState.fanoutCalls.find(
      (c) => c.category === "admin",
    );
    expect(conflictPush).toBeDefined();
    expect(conflictPush!.adminOnly).toBe(true);
    expect(conflictPush!.title).toContain("Score conflict");
    expect(conflictPush!.body).toContain("5");
    expect(conflictPush!.body).toContain("6");
  });

  it("does NOT fire conflict alert when scores agree", async () => {
    setDoc("leagues/sfbl/box_scores/g1", { home_score: 5 });
    setDoc("leagues/sfbl/box_score_submissions/g1_team_a", {
      game_id: "g1",
      team_id: "team_a",
      side: "away",
      lineup: [{ player_id: "p1", ab: 4 }],
      score: 7,
      opp_side: "home",
      opp_final_score: 5, // matches existing 5
    });
    await POST(makeReq({ leagueId: "sfbl", gameId: "g1" }));
    const conflictPush = mockState.fanoutCalls.find(
      (c) => c.category === "admin",
    );
    expect(conflictPush).toBeUndefined();
  });
});

describe("/api/captain-submit — Score Only mode", () => {
  it("captain's score-only submission writes empty lineup + score_only:true", async () => {
    setDoc("leagues/sfbl/box_score_submissions/g1_team_a", {
      game_id: "g1",
      team_id: "team_a",
      side: "away",
      score_only: true,
      final_score: 7,
      lineup: [], // empty
      pitchers: [],
    });
    const res = await POST(
      makeReq({ leagueId: "sfbl", gameId: "g1" }),
    );
    expect(res.status).toBe(200);
    const boxWrite = mockState.setCalls.find(
      (c) => c.path === "leagues/sfbl/box_scores/g1",
    );
    expect(boxWrite!.data.away_score_only).toBe(true);
    expect(boxWrite!.data.away_score).toBe(7);
    expect(boxWrite!.data.away_lineup).toEqual([]);
    expect(boxWrite!.data.away_pitchers).toEqual([]);
  });

  it("doesn't clobber opposing captain's full submission with our score-only opp", async () => {
    // Other captain already wrote full home stats.
    setDoc("leagues/sfbl/box_scores/g1", {
      home_lineup: [{ player_id: "p99", ab: 4, h: 2 }],
      home_score: 5,
      home_score_only: false,
    });
    // We submit score-only with a guess at home_score=6.
    setDoc("leagues/sfbl/box_score_submissions/g1_team_a", {
      game_id: "g1",
      team_id: "team_a",
      side: "away",
      score_only: true,
      final_score: 7,
      opp_side: "home",
      opp_score_only: true,
      opp_final_score: 6,
    });
    await POST(makeReq({ leagueId: "sfbl", gameId: "g1" }));
    const boxWrite = mockState.setCalls.find(
      (c) => c.path === "leagues/sfbl/box_scores/g1",
    );
    // Our home_score guess should NOT clobber the existing data.
    // The endpoint protects via oppHasFullStats check.
    expect(boxWrite!.data.home_score_only).toBeUndefined();
    expect(boxWrite!.data.home_score).toBeUndefined();
  });
});

describe("/api/captain-submit — admin path", () => {
  it("admin can submit on behalf of any team", async () => {
    mockState.decoded.leagues = { sfbl: "admin" };
    // Admin doesn't have a captain claim → captainTeamId is null in
    // the route. Submission promotion only runs for captain users.
    // This test just verifies the auth path: admin gets 200 with no
    // promotion (no captainTeamId → endpoint short-circuits the
    // promotion logic and runs recalc only).
    const res = await POST(
      makeReq({ leagueId: "sfbl", gameId: "g1" }),
    );
    expect(res.status).toBe(200);
    expect(mockState.recalcCalls).toHaveLength(1);
  });
});

describe("/api/captain-submit — failure modes", () => {
  it("returns 401 when verifyIdToken throws (expired/invalid bearer)", async () => {
    mockState.verifyThrows = true;
    const res = await POST(makeReq({ leagueId: "sfbl", gameId: "g1" }));
    expect(res.status).toBe(401);
    // Don't leak: no Firestore writes, no recalc, no push.
    expect(mockState.setCalls).toHaveLength(0);
    expect(mockState.recalcCalls).toHaveLength(0);
    expect(mockState.fanoutCalls).toHaveLength(0);
  });

  it("returns 400 on malformed JSON body", async () => {
    const req = new Request("http://test/api/captain-submit", {
      method: "POST",
      headers: {
        authorization: "Bearer fake",
        "content-type": "application/json",
      },
      body: "{this is not json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(mockState.recalcCalls).toHaveLength(0);
  });

  it("returns 400 when leagueId is missing", async () => {
    const res = await POST(makeReq({ gameId: "g1" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when gameId is missing", async () => {
    const res = await POST(makeReq({ leagueId: "sfbl" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when leagueId is empty string", async () => {
    const res = await POST(makeReq({ leagueId: "", gameId: "g1" }));
    expect(res.status).toBe(400);
  });

  it("returns 500 with error message when recalcLeague throws", async () => {
    // Submission exists + promotes successfully, but the recalc step
    // blows up. We must NOT swallow the error — captains need to
    // know stats didn't update so they can ping the commish.
    setDoc("leagues/sfbl/box_score_submissions/g1_team_a", {
      game_id: "g1",
      team_id: "team_a",
      side: "away",
      lineup: [{ player_id: "p1", ab: 4, h: 2 }],
      score: 7,
    });
    mockState.recalcThrows = true;
    const res = await POST(makeReq({ leagueId: "sfbl", gameId: "g1" }));
    expect(res.status).toBe(500);
    const data = (await res.json()) as { error: string };
    expect(data.error).toBe("aggregate failed");
  });

  it("doesn't fire conflict alert when sub.opp_side is missing", async () => {
    // Captain submits without filling in their view of opp's score.
    // No conflict alert should fire (nothing to compare against).
    setDoc("leagues/sfbl/box_scores/g1", { home_score: 5 });
    setDoc("leagues/sfbl/box_score_submissions/g1_team_a", {
      game_id: "g1",
      team_id: "team_a",
      side: "away",
      lineup: [{ player_id: "p1", ab: 4 }],
      score: 7,
      // no opp_side, no opp_final_score
    });
    await POST(makeReq({ leagueId: "sfbl", gameId: "g1" }));
    const conflictPush = mockState.fanoutCalls.find(
      (c) => c.category === "admin",
    );
    expect(conflictPush).toBeUndefined();
  });

  it("score push URL points to /games/[id], never to /captain", async () => {
    // Captain portal links would 404 for non-captains — push URL must
    // always be the public game page.
    setDoc("leagues/sfbl/box_score_submissions/g1_team_a", {
      game_id: "g1",
      team_id: "team_a",
      side: "away",
      lineup: [{ player_id: "p1", ab: 4 }],
      score: 7,
    });
    await POST(makeReq({ leagueId: "sfbl", gameId: "g1" }));
    for (const push of mockState.fanoutCalls) {
      if (push.url) {
        expect(push.url).not.toContain("/captain");
        // Either /games/* or /admin (conflict alert).
        expect(
          push.url.startsWith("/games/") || push.url === "/admin",
        ).toBe(true);
      }
    }
  });
});

// Defense-in-depth game-membership check (DVSL peer review §2,
// 2026-05-05). The Firestore rules block this at the submission-write
// boundary, but the API route should ALSO refuse to promote a
// submission whose captain isn't in the target game. Without this,
// a regression in the rules layer (or a future admin-bypass path)
// would let a captain pollute another game's box score.
describe("/api/captain-submit — game-membership defense", () => {
  it("403s when captain's team is in a DIFFERENT game (defense-in-depth)", async () => {
    // Set up a game where team_a is NOT a participant (team_c vs team_d).
    setDoc("leagues/sfbl/games/g_other", {
      home_team_id: "team_c",
      away_team_id: "team_d",
      status: "scheduled",
    });
    // The captain's submission lane somehow exists for that game (would
    // require the rules bug to land it there in real life, but test the
    // server-side defense in isolation).
    setDoc("leagues/sfbl/box_score_submissions/g_other_team_a", {
      game_id: "g_other",
      team_id: "team_a",
      side: "away",
      lineup: [{ player_id: "p1", ab: 4 }],
      score: 7,
    });
    mockState.decoded.leagues = { sfbl: "captain:team_a" };
    const res = await POST(
      makeReq({ leagueId: "sfbl", gameId: "g_other" }),
    );
    expect(res.status).toBe(403);
    // No public box-score write, no game write, no recalc, no push.
    expect(mockState.setCalls.filter((c) =>
      c.path.startsWith("leagues/sfbl/box_scores/"),
    )).toHaveLength(0);
    expect(mockState.setCalls.filter((c) =>
      c.path === "leagues/sfbl/games/g_other",
    )).toHaveLength(0);
    expect(mockState.recalcCalls).toHaveLength(0);
    expect(mockState.fanoutCalls).toHaveLength(0);
  });

  it("404s when the game doc itself doesn't exist (orphan submission)", async () => {
    // Submission exists but its game doesn't — return a clear 404
    // rather than letting the route proceed with a missing game.
    setDoc("leagues/sfbl/box_score_submissions/g_ghost_team_a", {
      game_id: "g_ghost",
      team_id: "team_a",
      side: "away",
      score: 5,
    });
    const res = await POST(
      makeReq({ leagueId: "sfbl", gameId: "g_ghost" }),
    );
    expect(res.status).toBe(404);
    expect(mockState.recalcCalls).toHaveLength(0);
  });

  it("captain of HOME team CAN still submit (regression check on the legitimate path)", async () => {
    // Team_b is home in g1. Captain of team_b should be allowed.
    mockState.decoded.leagues = { sfbl: "captain:team_b" };
    setDoc("leagues/sfbl/box_score_submissions/g1_team_b", {
      game_id: "g1",
      team_id: "team_b",
      side: "home",
      lineup: [{ player_id: "p3", ab: 4, h: 1 }],
      score: 5,
    });
    const res = await POST(makeReq({ leagueId: "sfbl", gameId: "g1" }));
    expect(res.status).toBe(200);
    expect(mockState.recalcCalls).toHaveLength(1);
  });

  it("captain of AWAY team CAN still submit (regression check on the legitimate path)", async () => {
    // Team_a is away in g1. Captain of team_a should be allowed.
    mockState.decoded.leagues = { sfbl: "captain:team_a" };
    setDoc("leagues/sfbl/box_score_submissions/g1_team_a", {
      game_id: "g1",
      team_id: "team_a",
      side: "away",
      lineup: [{ player_id: "p1", ab: 4, h: 2 }],
      score: 7,
    });
    const res = await POST(makeReq({ leagueId: "sfbl", gameId: "g1" }));
    expect(res.status).toBe(200);
  });
});
