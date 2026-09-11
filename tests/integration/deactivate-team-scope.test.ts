// Who may deactivate a team.
//
// Full admin, or the "teams" scope. It was full-admin-only from 2026-09-03
// until 2026-09-11, and the reversal is worth recording honestly: Mike never
// asked for the restriction. He asked for Kaitlin to have "roster access and
// she need to see the teams in each division", and this codebase read that as
// view-only on its own initiative. She hit the wall, and Adam reversed it.
//
// What these tests actually protect is the EDGE of the grant. The umpire in
// chief must still be refused, because "a scoped role can do it" is not the
// rule; "the role that holds teams can do it" is.

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = {
  decoded: {} as Record<string, unknown>,
  docs: new Map<string, Record<string, unknown>>(),
  sets: [] as { path: string; data: Record<string, unknown> }[],
  audits: [] as Record<string, unknown>[],
};

vi.mock("@/lib/firebase-admin", () => ({
  getAdminAuth: () => ({ verifyIdToken: vi.fn(async () => state.decoded) }),
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
    collection: () => ({
      add: async (r: Record<string, unknown>) => { state.audits.push(r); return { id: "a1" }; },
      async get() { return { docs: [] }; },
    }),
    batch: () => ({ set: () => {}, update: () => {}, commit: async () => {} }),
  }),
}));

const { POST } = await import("@/app/api/admin-team/route");

const TEAM = "jblFxWmdtlbYMk2UPZhz";
const PATH = `leagues/island/teams/${TEAM}`;

const FULL = { uid: "u-mike", email: "mike@example.com", leagues: { island: "admin" } };
const KAITLIN = {
  uid: "public-admin:island:scheduler",
  email: "kaitlin@example.com",
  leagues: { island: "admin:scheduler" },
  admin_role: "scheduler",
  admin_scopes: ["scores", "schedule", "teams", "fields", "rules"],
};
const UMPIRE_CHIEF = {
  uid: "public-admin:island:umpires",
  leagues: { island: "admin:umpires" },
  admin_role: "umpires",
  admin_scopes: ["umpires"],
};

const deactivate = (leagueId = "island") =>
  POST(new Request("https://x.test/api/admin-team", {
    method: "POST",
    headers: { authorization: "Bearer t", "content-type": "application/json" },
    body: JSON.stringify({ leagueId, teamId: TEAM, action: "delete" }),
  }));

beforeEach(() => {
  state.docs = new Map([[PATH, { name: "Sandlot Girls", active: true }]]);
  state.sets = []; state.audits = [];
});

describe("deactivating a team", () => {
  it("lets Kaitlin do it, which is the change", async () => {
    state.decoded = KAITLIN;
    const res = await deactivate();
    expect(res.status).toBe(200);
    expect(state.docs.get(PATH)?.active).toBe(false);
  });

  it("names her in the audit log, which did not exist before", async () => {
    state.decoded = KAITLIN;
    await deactivate();
    const a = state.audits[0]!;
    expect(a.kind).toBe("deactivate_team");
    expect(a.team_name).toBe("Sandlot Girls");
    expect(a.by_email).toBe("kaitlin@example.com");
    expect(a.by_role).toBe("scheduler");
  });

  it("records the full admin as admin, not as a role", async () => {
    state.decoded = FULL;
    await deactivate();
    expect(state.audits[0]?.by_role).toBe("admin");
    expect(state.docs.get(PATH)?.active).toBe(false);
  });

  it("STILL refuses the umpire in chief: holding a scope is not enough", async () => {
    state.decoded = UMPIRE_CHIEF;
    const res = await deactivate();
    expect(res.status).toBe(403);
    expect(state.docs.get(PATH)?.active).toBe(true);
    expect(state.audits).toEqual([]);
  });

  it("refuses her in a league she holds no role in", async () => {
    state.decoded = KAITLIN;
    const res = await deactivate("coybl");
    expect(res.status).toBe(403);
    expect(state.docs.get(PATH)?.active).toBe(true);
  });

  it("soft deletes, so the games and standings history survive", async () => {
    state.decoded = KAITLIN;
    await deactivate();
    const d = state.docs.get(PATH)!;
    expect(d.active).toBe(false);
    expect(d.name).toBe("Sandlot Girls");
    expect(d.deactivated_at).toBeTruthy();
  });
});
