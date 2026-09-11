// Who may record a shirt payment.
//
// This route was written full-admin-only on 2026-09-10 with the reasoning
// spelled out in its header: "Recording money is the one thing a scoped helper
// should not be able to do on their own." Mike reversed that on 2026-09-11 for
// Kaitlin, who fields the "did you get my Venmo" calls.
//
// The reversal is narrow and these tests hold the edges of it: she may record
// and clear a peer-to-peer payment, she may NOT touch a card order, and no
// other scoped role gets in at all. Card refunds stay in Square, where the
// money actually is.

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = {
  decoded: {} as Record<string, unknown>,
  doc: undefined as Record<string, unknown> | undefined,
  sets: [] as Record<string, unknown>[],
  updates: [] as Record<string, unknown>[],
  audits: [] as Record<string, unknown>[],
};

vi.mock("@/lib/firebase-admin", () => ({
  getAdminAuth: () => ({ verifyIdToken: vi.fn(async () => state.decoded) }),
  getAdminDb: () => ({
    doc: () => ({
      async get() {
        return { exists: state.doc !== undefined, data: () => state.doc };
      },
      async set(d: Record<string, unknown>) { state.sets.push(d); },
      async update(d: Record<string, unknown>) { state.updates.push(d); },
    }),
    collection: () => ({
      add: async (r: Record<string, unknown>) => { state.audits.push(r); return { id: "a1" }; },
    }),
  }),
}));

const { POST } = await import("@/app/api/admin-merch-payment/route");

const KAITLIN = {
  uid: "public-admin:island:scheduler",
  email: "kaitlin@example.com",
  leagues: { island: "admin:scheduler" },
  admin_role: "scheduler",
  admin_scopes: ["scores", "schedule", "teams", "payments"],
};
const UMPIRE_CHIEF = {
  uid: "public-admin:island:umpires",
  leagues: { island: "admin:umpires" },
  admin_role: "umpires",
  admin_scopes: ["umpires"],
};
const FULL = { uid: "u-mike", email: "mike@example.com", leagues: { island: "admin" } };

const post = (body: Record<string, unknown>) =>
  POST(new Request("https://x.test/api/admin-merch-payment", {
    method: "POST",
    headers: { authorization: "Bearer t", "content-type": "application/json" },
    body: JSON.stringify({ leagueId: "island", id: "order1", ...body }),
  }));

beforeEach(() => {
  state.doc = { amount_due: 30, payment: {} };
  state.sets = []; state.updates = []; state.audits = [];
});

describe("recording a shirt payment", () => {
  it("lets Kaitlin record a Venmo payment, stamped with her name", async () => {
    state.decoded = KAITLIN;
    const res = await post({ action: "paid", method: "venmo" });
    expect(res.status).toBe(200);
    const p = state.sets[0]?.payment as Record<string, unknown>;
    expect(p.status).toBe("paid");
    expect(p.method).toBe("venmo");
    expect(p.amount_cents).toBe(3000);
    expect(p.recorded_by_email).toBe("kaitlin@example.com");
    expect(state.audits[0]?.by_uid).toBe(KAITLIN.uid);
  });

  it("lets her clear one she recorded by mistake", async () => {
    state.decoded = KAITLIN;
    state.doc = { amount_due: 30, payment: { status: "paid", method: "zelle" } };
    expect((await post({ action: "clear" })).status).toBe(200);
    expect(state.updates[0]?.payment_status).toBe("unpaid");
  });

  it("still refuses to let ANYONE clear a card payment by hand", async () => {
    state.doc = { amount_due: 30, payment: { status: "paid", method: "card" } };
    for (const who of [KAITLIN, FULL]) {
      state.decoded = who;
      const res = await post({ action: "clear" });
      expect(res.status).toBe(409);
      expect((await res.json()).error).toMatch(/Square/);
    }
    expect(state.updates).toEqual([]);
  });

  it("refuses a scoped role that does not hold payments", async () => {
    state.decoded = UMPIRE_CHIEF;
    expect((await post({ action: "paid", method: "venmo" })).status).toBe(403);
    expect(state.sets).toEqual([]);
  });

  it("refuses her token in a league she has no role in", async () => {
    state.decoded = KAITLIN;
    const res = await POST(new Request("https://x.test/api/admin-merch-payment", {
      method: "POST",
      headers: { authorization: "Bearer t", "content-type": "application/json" },
      body: JSON.stringify({ leagueId: "coybl", id: "order1", action: "paid" }),
    }));
    expect(res.status).toBe(403);
  });

  it("will not record the same order twice", async () => {
    state.decoded = KAITLIN;
    state.doc = { amount_due: 30, payment: { status: "paid", method: "venmo" } };
    expect((await post({ action: "paid", method: "venmo" })).status).toBe(409);
  });
});
