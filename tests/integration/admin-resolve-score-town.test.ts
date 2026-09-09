// /api/admin-resolve-score and the town commissioner role.
//
// No town-bound role holds "score-disputes" (lib/admin-roles TOWN_SCOPES), so a
// commissioner is refused at the scope gate before the route's own town check
// runs. That check exists for the day TOWN_SCOPES is widened; these tests pin
// today's behaviour — refused, nothing written — and that the full admin is
// unchanged.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = {
  decoded: {} as Record<string, unknown>,
  docs: new Map<string, Record<string, unknown>>(),
  sets: [] as { path: string; data: Record<string, unknown> }[],
  audits: [] as Record<string, unknown>[],
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
        return { exists: d !== undefined, data: () => d };
      },
      async set(data: Record<string, unknown>) {
        state.sets.push({ path, data });
        state.docs.set(path, { ...(state.docs.get(path) ?? {}), ...data });
      },
    }),
    collection: (path: string) => ({
      add: async (rec: Record<string, unknown>) => {
        state.audits.push({ path, ...rec });
        return { id: "audit1" };
      },
    }),
  }),
}));
vi.mock("@/lib/stats-off-recap", () => ({
  invalidateGeneratedRecap: vi.fn(async () => undefined),
}));

const { POST } = await import("@/app/api/admin-resolve-score/route");

const L = "etbl";
const MINEOLA = {
  uid: "public-admin:etbl:mineola",
  leagues: { etbl: "admin:mineola" },
  admin_role: "mineola",
  admin_scopes: ["scores"],
  admin_town: "Mineola",
};
const ADMIN = { uid: "public-admin:etbl", leagues: { etbl: "admin" } };

function req(body: Record<string, unknown>): Request {
  return new Request("http://test/api/admin-resolve-score", {
    method: "POST",
    headers: { authorization: "Bearer fake", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  state.docs = new Map();
  state.sets = [];
  state.audits = [];
  state.docs.set(`leagues/${L}/teams/quitman_10u`, { organization: "Quitman" });
  state.docs.set(`leagues/${L}/teams/hawkins_10u`, { organization: "Hawkins" });
  state.docs.set(`leagues/${L}/games/g_quit_hawk`, {
    away_team_id: "quitman_10u",
    home_team_id: "hawkins_10u",
    score_disputed: true,
  });
  state.docs.set(`leagues/${L}/score_disputes/d1`, {
    game_id: "g_quit_hawk",
    status: "open",
  });
});
afterEach(() => vi.clearAllMocks());

describe("town commissioner", () => {
  it("cannot resolve a dispute (no score-disputes scope) — nothing written", async () => {
    state.decoded = MINEOLA;
    const res = await POST(
      req({ leagueId: L, disputeId: "d1", home_score: 30, away_score: 22 }),
    );
    expect(res.status).toBe(403);
    expect(state.sets).toHaveLength(0);
  });

  it("cannot dismiss one either", async () => {
    state.decoded = MINEOLA;
    const res = await POST(req({ leagueId: L, disputeId: "d1", action: "dismiss" }));
    expect(res.status).toBe(403);
    expect(state.sets).toHaveLength(0);
  });
});

describe("full admin", () => {
  it("resolves as before, and the audit says so", async () => {
    state.decoded = ADMIN;
    const res = await POST(
      req({ leagueId: L, disputeId: "d1", home_score: 30, away_score: 22 }),
    );
    expect(res.status).toBe(200);
    expect(state.docs.get(`leagues/${L}/games/g_quit_hawk`)).toMatchObject({
      home_score: 30,
      away_score: 22,
      status: "final",
      score_disputed: false,
    });
    const audit = state.audits.find((a) => a.kind === "score_dispute_resolved");
    expect(audit).toMatchObject({ by_role: "admin", game_id: "g_quit_hawk" });
    expect(audit).not.toHaveProperty("town");
  });

  it("dismisses as before", async () => {
    state.decoded = ADMIN;
    const res = await POST(req({ leagueId: L, disputeId: "d1", action: "dismiss" }));
    expect(res.status).toBe(200);
    expect(state.docs.get(`leagues/${L}/score_disputes/d1`)).toMatchObject({
      status: "dismissed",
    });
  });
});
