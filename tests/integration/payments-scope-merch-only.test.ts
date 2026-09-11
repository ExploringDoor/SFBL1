// The "payments" scope reads STORE ORDERS and nothing else.
//
// Kaitlin via Adam, 2026-09-11, Mike approved: "give me access to see payments
// made for league and shirts."
//
// League fees have their own tab. The shirt report does not: it lives inside
// the Form submissions tab, next to every player and team registration, every
// signed waiver, and the clinic families. So the tab has to open for her, and
// that means the TAB STRIP IS NOT THE BOUNDARY. This endpoint is.
//
// The failure this guards against is the one already written down in
// reference_tenant_leak_shared_admin: gating the render block and forgetting
// the thing behind it. Here the UI flag (merchOnly) is only a courtesy so she
// does not stare at empty tabs. If it were the whole control, typing a
// different `kind` into the URL would hand over the children's contact
// details the scoped roles exist to protect.

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = {
  decoded: {} as Record<string, unknown>,
  items: [] as Record<string, unknown>[],
  queried: [] as string[],
};

vi.mock("@/lib/firebase-admin", () => ({
  getAdminAuth: () => ({ verifyIdToken: vi.fn(async () => state.decoded) }),
  getAdminDb: () => ({
    collection: (path: string) => {
      state.queried.push(path);
      const chain = {
        orderBy: () => chain,
        limit: () => chain,
        async get() {
          return {
            docs: state.items.map((d, i) => ({ id: `i${i}`, data: () => d })),
          };
        },
      };
      return chain;
    },
  }),
}));

const { GET } = await import("@/app/api/admin-form-submissions/route");

const L = "island";
const FULL = { uid: "u-mike", leagues: { island: "admin" } };
const KAITLIN = {
  uid: "public-admin:island:scheduler",
  leagues: { island: "admin:scheduler" },
  admin_role: "scheduler",
  admin_scopes: [
    "scores", "schedule", "schedule-gen", "score-disputes",
    "broadcast", "teams", "fields", "rules", "payments",
  ],
};
const UMPIRE_CHIEF = {
  uid: "public-admin:island:umpires",
  leagues: { island: "admin:umpires" },
  admin_role: "umpires",
  admin_scopes: ["umpires"],
};

const call = (kind: string) =>
  GET(
    new Request(
      `https://x.test/api/admin-form-submissions?leagueId=${L}&kind=${kind}`,
      { headers: { authorization: "Bearer t" } },
    ),
  );

beforeEach(() => {
  state.items = [{ team_name: "Sandlot Girls", size: "YL" }];
  state.queried = [];
});

describe("the payments scope on /api/admin-form-submissions", () => {
  it("reads store orders", async () => {
    state.decoded = KAITLIN;
    const res = await call("merch_order");
    expect(res.status).toBe(200);
    expect((await res.json()).items).toHaveLength(1);
  });

  it("is REFUSED every other kind, whatever the UI asked for", async () => {
    state.decoded = KAITLIN;
    for (const kind of [
      "player_registration",
      "team_registration",
      "player_waiver",
      "team_waiver",
      "clinic_registration",
      "alerts_signup",
      "coach_evaluation",
    ]) {
      const res = await call(kind);
      expect(res.status, `${kind} must be refused`).toBe(403);
      // and nothing was read on the way to saying no
      expect(state.queried).toEqual([]);
    }
  });

  it("names the limit rather than saying 'not admin', so she can tell Mike", async () => {
    state.decoded = KAITLIN;
    const body = (await (await call("player_waiver")).json()) as { error: string };
    expect(body.error).toMatch(/store orders/i);
  });

  it("leaves the full admin reading everything", async () => {
    state.decoded = FULL;
    for (const kind of ["merch_order", "player_registration", "player_waiver"]) {
      expect((await call(kind)).status).toBe(200);
    }
  });

  it("gives a DIFFERENT scoped role nothing at all, store orders included", async () => {
    state.decoded = UMPIRE_CHIEF;
    for (const kind of ["merch_order", "player_registration"]) {
      expect((await call(kind)).status).toBe(403);
    }
    expect(state.queried).toEqual([]);
  });

  it("does not leak across tenants: the same token is nobody in another league", async () => {
    state.decoded = KAITLIN;
    const res = await GET(
      new Request(
        "https://x.test/api/admin-form-submissions?leagueId=coybl&kind=merch_order",
        { headers: { authorization: "Bearer t" } },
      ),
    );
    expect(res.status).toBe(403);
  });
});
