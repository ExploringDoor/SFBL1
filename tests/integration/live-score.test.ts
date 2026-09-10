// Integration tests for /api/live-score — the field-side scorekeeper.
//
// What these pin:
//   1. a scoped "scores" role (a town commissioner) can run the clock on a
//      game with a team from their town, and is refused — nothing written —
//      on another town's game; a role without "scores" is refused outright
//   2. basketball deltas: +2 and +3 land, anything odd is a +1, -1 takes back
//   3. finalize also writes the score-only box_scores doc the other scoring
//      lanes write, so the tenant audit and the public game page agree

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = {
  decoded: {} as Record<string, unknown>,
  docs: new Map<string, Record<string, unknown>>(),
  sets: [] as { path: string; data: Record<string, unknown> }[],
};

vi.mock("@/lib/firebase-admin", () => ({
  getAdminAuth: () => ({
    verifyIdToken: vi.fn(async () => state.decoded),
  }),
  getAdminDb: () => ({
    doc: (path: string) => ({
      id: path.split("/").pop(),
      async get() {
        const d = state.docs.get(path);
        return { id: path.split("/").pop(), exists: d !== undefined, data: () => d };
      },
      async set(data: Record<string, unknown>) {
        state.sets.push({ path, data });
        state.docs.set(path, { ...(state.docs.get(path) ?? {}), ...data });
      },
    }),
  }),
}));
vi.mock("@/lib/stats-off-recap", () => ({
  invalidateGeneratedRecap: vi.fn(async () => undefined),
}));

const { POST } = await import("@/app/api/live-score/route");

const L = "etbl";
const ADMIN = { uid: "public-admin:etbl", leagues: { etbl: "admin" } };
const MINEOLA = {
  uid: "public-admin:etbl:mineola",
  leagues: { etbl: "admin:mineola" },
  admin_role: "mineola",
  admin_scopes: ["scores"],
  admin_town: "Mineola",
};
const UMPIRE = {
  uid: "public-admin:etbl:umpires",
  leagues: { etbl: "admin:umpires" },
  admin_role: "umpires",
  admin_scopes: ["umpires"],
};

function req(body: Record<string, unknown>): Request {
  return new Request("http://test/api/live-score", {
    method: "POST",
    headers: { authorization: "Bearer fake", "content-type": "application/json" },
    body: JSON.stringify({ leagueId: L, ...body }),
  });
}
const game = (id: string) => state.docs.get(`leagues/${L}/games/${id}`)!;

beforeEach(() => {
  state.docs = new Map();
  state.sets = [];
  state.decoded = ADMIN;
  state.docs.set(`leagues/${L}/teams/mineola_3b`, { organization: "Mineola" });
  state.docs.set(`leagues/${L}/teams/quitman_3b`, { organization: "Quitman" });
  state.docs.set(`leagues/${L}/teams/hawkins_3b`, { organization: "Hawkins" });
  state.docs.set(`leagues/${L}/games/g_min_quit`, {
    away_team_id: "mineola_3b",
    home_team_id: "quitman_3b",
    status: "scheduled",
    away_score: 0,
    home_score: 0,
  });
  state.docs.set(`leagues/${L}/games/g_quit_hawk`, {
    away_team_id: "quitman_3b",
    home_team_id: "hawkins_3b",
    status: "scheduled",
    away_score: 0,
    home_score: 0,
  });
});
afterEach(() => vi.clearAllMocks());

describe("who may run the clock", () => {
  it("a Mineola commissioner scores a Mineola game", async () => {
    state.decoded = MINEOLA;
    const res = await POST(req({ gameId: "g_min_quit", action: "run", side: "away", delta: 2 }));
    expect(res.status).toBe(200);
    expect(game("g_min_quit")).toMatchObject({ away_score: 2, status: "live" });
  });

  it("…but not another town's game, and nothing is written", async () => {
    state.decoded = MINEOLA;
    const res = await POST(req({ gameId: "g_quit_hawk", action: "go_live" }));
    expect(res.status).toBe(403);
    expect(state.sets).toHaveLength(0);
    expect(game("g_quit_hawk").status).toBe("scheduled");
  });

  it("a scoped role without 'scores' is refused", async () => {
    state.decoded = UMPIRE;
    const res = await POST(req({ gameId: "g_min_quit", action: "go_live" }));
    expect(res.status).toBe(403);
    expect(state.sets).toHaveLength(0);
  });

  it("the full admin runs any game", async () => {
    const res = await POST(req({ gameId: "g_quit_hawk", action: "go_live" }));
    expect(res.status).toBe(200);
    expect(game("g_quit_hawk")).toMatchObject({ status: "live", current_inning: 1 });
  });
});

describe("basketball deltas", () => {
  it("+2 and +3 land, -1 takes one back, anything else is a +1", async () => {
    await POST(req({ gameId: "g_min_quit", action: "run", side: "home", delta: 3 }));
    await POST(req({ gameId: "g_min_quit", action: "run", side: "home", delta: 2 }));
    await POST(req({ gameId: "g_min_quit", action: "run", side: "home", delta: 7 }));
    await POST(req({ gameId: "g_min_quit", action: "run", side: "home", delta: -1 }));
    expect(game("g_min_quit").home_score).toBe(5);
  });

  it("the score never goes below zero", async () => {
    await POST(req({ gameId: "g_min_quit", action: "run", side: "away", delta: -1 }));
    expect(game("g_min_quit").away_score).toBe(0);
  });

  it("periods step with set_inning, up to overtime", async () => {
    const res = await POST(req({ gameId: "g_min_quit", action: "set_inning", inning: 5, half: "top" }));
    expect(res.status).toBe(200);
    expect(game("g_min_quit").current_inning).toBe(5);
  });
});

describe("finalize", () => {
  it("flips the game to final and writes the score-only box_scores doc", async () => {
    await POST(req({ gameId: "g_min_quit", action: "set_score", away_score: 31, home_score: 24 }));
    const res = await POST(req({ gameId: "g_min_quit", action: "finalize" }));
    expect(res.status).toBe(200);
    expect(game("g_min_quit")).toMatchObject({ status: "final", away_score: 31, home_score: 24 });
    expect(state.docs.get(`leagues/${L}/box_scores/g_min_quit`)).toMatchObject({
      away_team_id: "mineola_3b",
      home_team_id: "quitman_3b",
      away_score: 31,
      home_score: 24,
      away_lineup_score_only: true,
      home_lineup_score_only: true,
      status: "final",
    });
  });

  it("a plain run does not write a box_scores doc", async () => {
    await POST(req({ gameId: "g_min_quit", action: "run", side: "away" }));
    expect(state.docs.has(`leagues/${L}/box_scores/g_min_quit`)).toBe(false);
  });
});
