// Integration tests for the TOWN boundary on /api/admin-score-quick.
//
// ETBL is run by one commissioner per town, each with a password that may
// enter scores only for games involving a team from that town. The team's
// `organization` field is the binding; the token's `admin_town` names the
// town; lib/admin-town.ts does the check inside the route, before any write.
//
// What these pin, in order of how badly it would hurt to get wrong:
//   1. a foreign game is refused with NOTHING written, and a batch that mixes
//      one foreign game in with legitimate ones is refused whole
//   2. a team nobody assigned to a town is in nobody's town
//   3. the full admin is unaffected and pays for zero team reads
//   4. a scoped role without "scores" fails before any read at all

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = {
  decoded: {} as Record<string, unknown>,
  docs: new Map<string, Record<string, unknown>>(),
  sets: [] as { path: string; data: Record<string, unknown> }[],
  audits: [] as Record<string, unknown>[],
  reads: [] as string[],
};

function docRef(path: string) {
  const id = path.split("/").pop()!;
  const ref = {
    id,
    async get() {
      state.reads.push(path);
      const d = state.docs.get(path);
      return { id, exists: d !== undefined, data: () => d, ref };
    },
    async set(data: Record<string, unknown>) {
      state.sets.push({ path, data });
      state.docs.set(path, { ...(state.docs.get(path) ?? {}), ...data });
    },
  };
  return ref;
}

vi.mock("@/lib/firebase-admin", () => ({
  getAdminAuth: () => ({
    verifyIdToken: vi.fn(async () => state.decoded),
  }),
  getAdminDb: () => ({
    doc: docRef,
    collection: (path: string) => ({
      add: async (rec: Record<string, unknown>) => {
        state.audits.push({ path, ...rec });
        return { id: "audit1" };
      },
    }),
  }),
}));
vi.mock("@/lib/stats", () => ({
  recalcLeague: vi.fn(async () => ({ players_written: 0 })),
}));
vi.mock("@/lib/stats-off-recap", () => ({
  invalidateGeneratedRecap: vi.fn(async () => undefined),
}));

const { POST } = await import("@/app/api/admin-score-quick/route");

const L = "etbl";

const MINEOLA = {
  uid: "public-admin:etbl:mineola",
  leagues: { etbl: "admin:mineola" },
  admin_role: "mineola",
  admin_scopes: ["scores"],
  admin_town: "Mineola",
};
const ADMIN = { uid: "public-admin:etbl", leagues: { etbl: "admin" } };
const UMPIRE = {
  uid: "public-admin:etbl:umpires",
  leagues: { etbl: "admin:umpires" },
  admin_role: "umpires",
  admin_scopes: ["umpires"],
};

function req(body: Record<string, unknown>): Request {
  return new Request("http://test/api/admin-score-quick", {
    method: "POST",
    headers: {
      authorization: "Bearer fake",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}
const quick = (...gameIds: string[]) =>
  req({
    leagueId: L,
    updates: gameIds.map((gameId) => ({
      gameId,
      away_score: 24,
      home_score: 18,
      status: "final",
    })),
  });

function seed() {
  state.docs = new Map();
  const team = (id: string, org?: string) =>
    state.docs.set(`leagues/${L}/teams/${id}`, {
      name: id,
      ...(org !== undefined ? { organization: org } : {}),
    });
  team("mineola_10u", "Mineola");
  team("quitman_10u", "Quitman");
  team("hawkins_10u", "Hawkins");
  team("noorg_10u");
  team("lower_10u", "  mineola ");
  const game = (id: string, away: string, home: string) =>
    state.docs.set(`leagues/${L}/games/${id}`, {
      away_team_id: away,
      home_team_id: home,
      status: "scheduled",
    });
  game("g_min_quit", "mineola_10u", "quitman_10u");
  game("g_quit_hawk", "quitman_10u", "hawkins_10u");
  game("g_noorg_hawk", "noorg_10u", "hawkins_10u");
  game("g_lower_hawk", "lower_10u", "hawkins_10u");
}

beforeEach(() => {
  seed();
  state.sets = [];
  state.audits = [];
  state.reads = [];
  state.decoded = MINEOLA;
});
afterEach(() => vi.clearAllMocks());

const gameWrites = () => state.sets.filter((s) => s.path.includes("/games/"));

describe("a Mineola commissioner", () => {
  it("scores a Mineola game, and the audit names the town and role", async () => {
    const res = await POST(quick("g_min_quit"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; written: string[] };
    expect(body.ok).toBe(true);
    expect(body.written).toEqual(["g_min_quit"]);
    expect(state.docs.get(`leagues/${L}/games/g_min_quit`)).toMatchObject({
      status: "final",
      away_score: 24,
      home_score: 18,
      updated_by_uid: "public-admin:etbl:mineola",
    });
    const audit = state.audits.find((a) => a.kind === "score_quick_batch");
    expect(audit).toMatchObject({ by_role: "mineola", town: "Mineola" });
  });

  it("is refused a game between two other towns, and nothing is written", async () => {
    const res = await POST(quick("g_quit_hawk"));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; forbidden_game_ids: string[] };
    expect(body.forbidden_game_ids).toEqual(["g_quit_hawk"]);
    expect(body.error).toMatch(/Mineola/);
    expect(state.sets).toHaveLength(0);
    expect(state.audits).toHaveLength(0);
  });

  it("has a whole batch refused when one foreign game rides along", async () => {
    const res = await POST(quick("g_min_quit", "g_quit_hawk"));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { forbidden_game_ids: string[] };
    expect(body.forbidden_game_ids).toEqual(["g_quit_hawk"]);
    // The legitimate game in the same batch was NOT written either.
    expect(gameWrites()).toHaveLength(0);
  });

  it("matches the town case- and whitespace-insensitively", async () => {
    const res = await POST(quick("g_lower_hawk"));
    expect(res.status).toBe(200);
    expect(gameWrites()).toHaveLength(1);
  });

  it("never owns a team that nobody assigned to a town", async () => {
    const res = await POST(quick("g_noorg_hawk"));
    expect(res.status).toBe(403);
    expect(state.sets).toHaveLength(0);
  });

  it("cannot resolve a captain conflict on a foreign game either", async () => {
    const res = await POST(
      req({ leagueId: L, action: "use_submission", gameId: "g_quit_hawk", side: "away" }),
    );
    expect(res.status).toBe(403);
    expect(state.sets).toHaveLength(0);
  });

  it("sees a missing game as 'not found', not as a permission error", async () => {
    const res = await POST(quick("g_missing"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      errors: { gameId: string; error: string }[];
    };
    expect(body.ok).toBe(false);
    expect(body.errors[0]).toEqual({ gameId: "g_missing", error: "game not found" });
  });
});

describe("everyone else", () => {
  it("the full admin scores any game and pays for zero team reads", async () => {
    state.decoded = ADMIN;
    const res = await POST(quick("g_quit_hawk"));
    expect(res.status).toBe(200);
    expect(gameWrites()).toHaveLength(1);
    expect(state.reads.filter((p) => p.includes("/teams/"))).toHaveLength(0);
    const audit = state.audits.find((a) => a.kind === "score_quick_batch");
    expect(audit).toMatchObject({ by_role: "admin" });
    expect(audit).not.toHaveProperty("town");
  });

  it("a scoped role without 'scores' fails before any read", async () => {
    state.decoded = UMPIRE;
    const res = await POST(quick("g_min_quit"));
    expect(res.status).toBe(403);
    expect(state.reads).toHaveLength(0);
    expect(state.sets).toHaveLength(0);
  });

  it("a Mineola token for another league grants nothing here", async () => {
    state.decoded = { ...MINEOLA, leagues: { island: "admin:mineola" } };
    const res = await POST(quick("g_min_quit"));
    expect(res.status).toBe(403);
    expect(state.reads).toHaveLength(0);
  });
});
