// Cross-endpoint multi-tenant boundary smoke test.
//
// This test exists as a belt-and-suspenders check: we have rules-
// level tests, individual endpoint auth tests, and the pure-matcher
// notification isolation test. This file asserts the SAME invariant
// (caller in league A can't write/read in league B) hits at the
// ENDPOINT layer for every mutating + sensitive-read endpoint, in
// one place. When someone adds a new endpoint, the easy mistake is
// forgetting the league check; this file documents what the
// boundary looks like and would fail loudly if a regression slipped
// through.
//
// Test pattern: caller has admin claim for "kcsl" only. They POST/
// GET to an endpoint scoped to "sfbl" (via body or query param).
// Every endpoint must return 403 (or 401/400 — anything non-2xx) and
// must NOT perform any side effects.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockState = {
  // Caller has admin in kcsl ONLY. They're an outsider to sfbl.
  decoded: {
    uid: "uid_outsider",
    email: "outsider@example.com",
    leagues: { kcsl: "admin" } as Record<string, string>,
  } as { uid: string; email?: string; leagues?: Record<string, string> },
  // Track whether ANY write happened — a 403 endpoint must not write.
  writes: 0,
  reads: 0,
};

vi.mock("@/lib/firebase-admin", () => ({
  getAdminAuth: () => ({
    verifyIdToken: vi.fn(async () => mockState.decoded),
    getUserByEmail: vi.fn(async () => {
      throw new Error("user-not-found");
    }),
    getUsers: vi.fn(async () => ({ users: [] })),
    setCustomUserClaims: vi.fn(async () => {
      mockState.writes++;
    }),
  }),
  getAdminDb: () => ({
    doc: () => ({
      get: async () => {
        mockState.reads++;
        return { exists: false, data: () => ({}) };
      },
      set: async () => {
        mockState.writes++;
      },
      delete: async () => {
        mockState.writes++;
      },
    }),
    collection: () => ({
      where: () => ({
        get: async () => {
          mockState.reads++;
          return { size: 0, docs: [] };
        },
        where: () => ({
          get: async () => {
            mockState.reads++;
            return { size: 0, docs: [] };
          },
        }),
      }),
      get: async () => {
        mockState.reads++;
        return { size: 0, docs: [] };
      },
      add: async () => {
        mockState.writes++;
      },
      doc: () => ({
        _path: "fake",
        set: async () => {
          mockState.writes++;
        },
      }),
    }),
    batch: () => ({
      delete: () => {
        mockState.writes++;
      },
      set: () => {
        mockState.writes++;
      },
      commit: async () => {},
    }),
  }),
  getAdminMessaging: () => ({
    send: vi.fn(),
  }),
}));

// Stub out @/lib/stats and @/lib/notifications/server-fanout because
// some endpoints import them; we don't want those side-effecting.
vi.mock("@/lib/stats", () => ({
  recalcLeague: vi.fn(),
}));
vi.mock("@/lib/notifications/server-fanout", () => ({
  fanoutPush: vi.fn(),
  originFromRequest: () => "http://test",
}));
vi.mock("@/lib/notifications/send", () => ({
  sendNotification: vi.fn(),
}));

const { POST: adminGrantClaim } = await import(
  "@/app/api/admin-grant-claim/route"
);
const { POST: adminBranding } = await import(
  "@/app/api/admin-branding/route"
);
const { POST: adminTeam } = await import("@/app/api/admin-team/route");
const { GET: adminAuditLog } = await import(
  "@/app/api/admin-audit-log/route"
);
const { GET: adminLeagueHealth } = await import(
  "@/app/api/admin-league-health/route"
);
const { POST: availabilityRsvp } = await import(
  "@/app/api/availability-rsvp/route"
);
const { POST: captainAddPlayer } = await import(
  "@/app/api/captain-add-player/route"
);
const { POST: captainLink } = await import(
  "@/app/api/captain-link/route"
);
const { POST: captainPayment } = await import(
  "@/app/api/captain-payment/route"
);
const { POST: captainRoster } = await import(
  "@/app/api/captain-roster/route"
);
const { POST: captainSchedule } = await import(
  "@/app/api/captain-schedule/route"
);
const { POST: captainSubmit } = await import(
  "@/app/api/captain-submit/route"
);
const { POST: chatMessage } = await import(
  "@/app/api/chat-message/route"
);
const { POST: chatMessageDelete } = await import(
  "@/app/api/chat-message-delete/route"
);
const { POST: chatReset } = await import("@/app/api/chat-reset/route");
const { POST: gameRecap } = await import("@/app/api/game-recap/route");
const { POST: pageContent } = await import(
  "@/app/api/page-content/route"
);
const { POST: playerLink } = await import("@/app/api/player-link/route");
const { POST: recalc } = await import("@/app/api/recalc/route");
const { POST: sendNotification } = await import(
  "@/app/api/send-notification/route"
);

function postReq(path: string, body: Record<string, unknown>): Request {
  return new Request(`http://test${path}`, {
    method: "POST",
    headers: {
      authorization: "Bearer fake",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function getReq(url: string): Request {
  return new Request(`http://test${url}`, {
    method: "GET",
    headers: { authorization: "Bearer fake" },
  });
}

beforeEach(() => {
  // Reset to outsider state. Caller has admin in kcsl only.
  mockState.decoded = {
    uid: "uid_outsider",
    email: "outsider@example.com",
    leagues: { kcsl: "admin" },
  };
  mockState.writes = 0;
  mockState.reads = 0;
});

afterEach(() => vi.clearAllMocks());

// Each describe corresponds to one endpoint. Each test asserts that
// a caller with no claim in target league "sfbl" (only admin in
// "kcsl") gets rejected with non-2xx, and that no writes happen.

describe("multi-tenant boundary — admin endpoints", () => {
  it("admin-grant-claim rejects cross-tenant", async () => {
    const res = await adminGrantClaim(
      postReq("/api/admin-grant-claim", {
        leagueId: "sfbl",
        email: "anyone@example.com",
        role: "captain",
        teamId: "team_a",
      }),
    );
    expect(res.status).not.toBeLessThan(400);
    expect(mockState.writes).toBe(0);
  });

  it("admin-branding rejects cross-tenant", async () => {
    const res = await adminBranding(
      postReq("/api/admin-branding", {
        leagueId: "sfbl",
        name: "Hijacked",
      }),
    );
    expect(res.status).not.toBeLessThan(400);
    expect(mockState.writes).toBe(0);
  });

  it("admin-team rejects cross-tenant", async () => {
    const res = await adminTeam(
      postReq("/api/admin-team", {
        leagueId: "sfbl",
        action: "create",
        teamId: "team_x",
        name: "Hijacked",
      }),
    );
    expect(res.status).not.toBeLessThan(400);
    expect(mockState.writes).toBe(0);
  });

  it("admin-audit-log rejects cross-tenant", async () => {
    const res = await adminAuditLog(
      getReq("/api/admin-audit-log?leagueId=sfbl"),
    );
    expect(res.status).not.toBeLessThan(400);
  });

  it("admin-league-health rejects cross-tenant", async () => {
    const res = await adminLeagueHealth(
      getReq("/api/admin-league-health?leagueId=sfbl"),
    );
    expect(res.status).not.toBeLessThan(400);
  });

  it("page-content rejects cross-tenant", async () => {
    const res = await pageContent(
      postReq("/api/page-content", {
        leagueId: "sfbl",
        pageId: "rules",
        markdown: "# Hijacked rules",
      }),
    );
    expect(res.status).not.toBeLessThan(400);
    expect(mockState.writes).toBe(0);
  });

  it("recalc rejects cross-tenant", async () => {
    const res = await recalc(
      postReq("/api/recalc", { leagueId: "sfbl" }),
    );
    expect(res.status).not.toBeLessThan(400);
  });
});

describe("multi-tenant boundary — captain endpoints", () => {
  // Switch caller to captain — same outsider posture, just captain
  // claim now (still in kcsl, not sfbl).
  beforeEach(() => {
    mockState.decoded.leagues = { kcsl: "captain:team_kc" };
  });

  it("captain-add-player rejects cross-tenant", async () => {
    const res = await captainAddPlayer(
      postReq("/api/captain-add-player", {
        leagueId: "sfbl",
        name: "Hijacked",
      }),
    );
    expect(res.status).not.toBeLessThan(400);
    expect(mockState.writes).toBe(0);
  });

  it("captain-link rejects cross-tenant", async () => {
    const res = await captainLink(
      postReq("/api/captain-link", { leagueId: "sfbl" }),
    );
    expect(res.status).not.toBeLessThan(400);
    expect(mockState.writes).toBe(0);
  });

  it("captain-payment rejects cross-tenant", async () => {
    const res = await captainPayment(
      postReq("/api/captain-payment", {
        leagueId: "sfbl",
        playerId: "p1",
        paid: true,
      }),
    );
    expect(res.status).not.toBeLessThan(400);
    expect(mockState.writes).toBe(0);
  });

  it("captain-roster rejects cross-tenant", async () => {
    const res = await captainRoster(
      postReq("/api/captain-roster", {
        leagueId: "sfbl",
        action: "add",
        name: "Hijacked",
      }),
    );
    expect(res.status).not.toBeLessThan(400);
    expect(mockState.writes).toBe(0);
  });

  it("captain-schedule rejects cross-tenant", async () => {
    const res = await captainSchedule(
      postReq("/api/captain-schedule", {
        leagueId: "sfbl",
        gameId: "g1",
        date: "2026-05-20",
      }),
    );
    expect(res.status).not.toBeLessThan(400);
    expect(mockState.writes).toBe(0);
  });

  it("captain-submit rejects cross-tenant", async () => {
    const res = await captainSubmit(
      postReq("/api/captain-submit", {
        leagueId: "sfbl",
        gameId: "g1",
      }),
    );
    expect(res.status).not.toBeLessThan(400);
    expect(mockState.writes).toBe(0);
  });
});

describe("multi-tenant boundary — chat + recap + availability", () => {
  beforeEach(() => {
    mockState.decoded.leagues = { kcsl: "captain:team_kc" };
  });

  it("availability-rsvp rejects cross-tenant", async () => {
    const res = await availabilityRsvp(
      postReq("/api/availability-rsvp", {
        leagueId: "sfbl",
        gameId: "g1",
        playerId: "p1",
        status: "yes",
      }),
    );
    expect(res.status).not.toBeLessThan(400);
    expect(mockState.writes).toBe(0);
  });

  it("chat-message rejects cross-tenant", async () => {
    const res = await chatMessage(
      postReq("/api/chat-message", {
        leagueId: "sfbl",
        collection: "team_messages",
        teamId: "team_a",
        text: "Hijacked message",
      }),
    );
    expect(res.status).not.toBeLessThan(400);
    expect(mockState.writes).toBe(0);
  });

  it("chat-message-delete rejects cross-tenant", async () => {
    const res = await chatMessageDelete(
      postReq("/api/chat-message-delete", {
        leagueId: "sfbl",
        collection: "team_messages",
        msgId: "m1",
      }),
    );
    expect(res.status).not.toBeLessThan(400);
    expect(mockState.writes).toBe(0);
  });

  it("chat-reset rejects cross-tenant", async () => {
    const res = await chatReset(
      postReq("/api/chat-reset", {
        leagueId: "sfbl",
        collection: "team_messages",
        teamId: "team_a",
      }),
    );
    expect(res.status).not.toBeLessThan(400);
    expect(mockState.writes).toBe(0);
  });

  it("game-recap rejects cross-tenant", async () => {
    const res = await gameRecap(
      postReq("/api/game-recap", {
        leagueId: "sfbl",
        gameId: "g1",
        markdown: "# Hijacked recap",
      }),
    );
    expect(res.status).not.toBeLessThan(400);
    expect(mockState.writes).toBe(0);
  });
});

describe("multi-tenant boundary — player + send-notification", () => {
  beforeEach(() => {
    // Even a player-claim user shouldn't be able to send-notification
    // outside their league. Reset to player.
    mockState.decoded.leagues = { kcsl: "player:p1" };
  });

  it("player-link rejects cross-tenant", async () => {
    // Player-link doesn't require a claim per se — it auto-links by
    // email. But the email lookup is scoped to leagueId, and player-
    // link doesn't gate on claim because anyone can self-link. The
    // boundary here is that the email match happens within the
    // target league's /players collection only — it can't link a
    // user to a league they have no record in.
    const res = await playerLink(
      postReq("/api/player-link", { leagueId: "sfbl" }),
    );
    // Should return 200 with matches: 0 (no /players record for this
    // user's email in sfbl). NOT a 403 since the endpoint is public-
    // ish, but no link is made.
    expect(res.status).toBe(200);
    const data = (await res.json()) as { matches: number };
    expect(data.matches).toBe(0);
    expect(mockState.writes).toBe(0);
  });

  it("send-notification rejects cross-tenant", async () => {
    const res = await sendNotification(
      postReq("/api/send-notification", {
        leagueId: "sfbl",
        title: "Hijacked",
        body: "x",
        category: "scores",
      }),
    );
    expect(res.status).not.toBeLessThan(400);
  });
});

describe("multi-tenant boundary — outsider with NO claims at all", () => {
  // Caller has zero league claims. Should fail every endpoint just
  // like the cross-tenant case above.
  beforeEach(() => {
    mockState.decoded.leagues = {};
  });

  it("admin-team rejects no-claim caller", async () => {
    const res = await adminTeam(
      postReq("/api/admin-team", {
        leagueId: "sfbl",
        action: "create",
        teamId: "team_x",
        name: "Hijacked",
      }),
    );
    expect(res.status).not.toBeLessThan(400);
    expect(mockState.writes).toBe(0);
  });

  it("captain-submit rejects no-claim caller", async () => {
    const res = await captainSubmit(
      postReq("/api/captain-submit", {
        leagueId: "sfbl",
        gameId: "g1",
      }),
    );
    expect(res.status).not.toBeLessThan(400);
    expect(mockState.writes).toBe(0);
  });

  it("chat-message rejects no-claim caller", async () => {
    const res = await chatMessage(
      postReq("/api/chat-message", {
        leagueId: "sfbl",
        collection: "team_messages",
        teamId: "team_a",
        text: "Hijacked",
      }),
    );
    expect(res.status).not.toBeLessThan(400);
    expect(mockState.writes).toBe(0);
  });

  it("send-notification rejects no-claim caller", async () => {
    const res = await sendNotification(
      postReq("/api/send-notification", {
        leagueId: "sfbl",
        title: "x",
        body: "x",
        category: "scores",
      }),
    );
    expect(res.status).not.toBeLessThan(400);
  });
});
