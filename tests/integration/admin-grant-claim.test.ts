// Integration test for /api/admin-grant-claim.
//
// Covers the Friday-critical flow: admin grants captain access to a
// teammate by email, without me having to ssh in and run a script.
//
// Mocks @/lib/firebase-admin's auth so we can drive verifyIdToken,
// getUserByEmail, and setCustomUserClaims. Asserts the claim mutation
// preserves other leagues' entries (multi-tenant correctness) and the
// self-demote guard fires.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface MockUser {
  uid: string;
  email: string;
  customClaims?: Record<string, unknown>;
}

const mockState = {
  callerUid: "uid_admin",
  callerLeagues: { sfbl: "admin" } as Record<string, string>,
  users: new Map<string, MockUser>(),
  // Captured calls.
  setClaimsCalls: [] as Array<{ uid: string; claims: Record<string, unknown> }>,
};

vi.mock("@/lib/firebase-admin", () => ({
  getAdminAuth: () => ({
    verifyIdToken: vi.fn(async () => ({
      uid: mockState.callerUid,
      leagues: mockState.callerLeagues,
    })),
    getUserByEmail: vi.fn(async (email: string) => {
      const u = mockState.users.get(email.toLowerCase());
      if (!u) {
        const err = new Error("auth/user-not-found");
        throw err;
      }
      return u;
    }),
    setCustomUserClaims: vi.fn(
      async (uid: string, claims: Record<string, unknown>) => {
        mockState.setClaimsCalls.push({ uid, claims });
        // Reflect back so subsequent reads see the update.
        for (const [k, v] of mockState.users) {
          if (v.uid === uid) {
            mockState.users.set(k, { ...v, customClaims: claims });
          }
        }
      },
    ),
  }),
  getAdminDb: () => ({}),
  getAdminMessaging: () => ({}),
}));

const { POST } = await import(
  "@/app/api/admin-grant-claim/route"
);

function makeReq(body: Record<string, unknown>): Request {
  return new Request("http://test/api/admin-grant-claim", {
    method: "POST",
    headers: {
      authorization: "Bearer fake",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockState.callerUid = "uid_admin";
  mockState.callerLeagues = { sfbl: "admin" };
  mockState.users = new Map();
  mockState.setClaimsCalls = [];
});

afterEach(() => vi.clearAllMocks());

describe("/api/admin-grant-claim — authority", () => {
  it("rejects callers who aren't admin of the target league", async () => {
    mockState.callerLeagues = { sfbl: "captain:team_a" };
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        email: "captain@example.com",
        role: "captain",
        teamId: "team_b",
      }),
    );
    expect(res.status).toBe(403);
  });

  it("rejects callers with admin in a different league", async () => {
    mockState.callerLeagues = { kcsl: "admin" }; // not sfbl
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        email: "captain@example.com",
        role: "captain",
        teamId: "team_b",
      }),
    );
    expect(res.status).toBe(403);
  });
});

describe("/api/admin-grant-claim — captain grant", () => {
  it("grants captain:team_a to a user with no existing claims", async () => {
    mockState.users.set("alice@example.com", {
      uid: "uid_alice",
      email: "alice@example.com",
    });
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        email: "alice@example.com",
        role: "captain",
        teamId: "team_a",
      }),
    );
    expect(res.status).toBe(200);
    expect(mockState.setClaimsCalls).toHaveLength(1);
    expect(mockState.setClaimsCalls[0]!.uid).toBe("uid_alice");
    expect(
      (mockState.setClaimsCalls[0]!.claims.leagues as Record<string, string>)
        .sfbl,
    ).toBe("captain:team_a");
  });

  it("preserves OTHER leagues' claims when granting", async () => {
    mockState.users.set("bob@example.com", {
      uid: "uid_bob",
      email: "bob@example.com",
      customClaims: { leagues: { kcsl: "captain:team_kc" } },
    });
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        email: "bob@example.com",
        role: "captain",
        teamId: "team_a",
      }),
    );
    expect(res.status).toBe(200);
    const newLeagues = mockState.setClaimsCalls[0]!.claims.leagues as Record<
      string,
      string
    >;
    // SFBL claim added
    expect(newLeagues.sfbl).toBe("captain:team_a");
    // KCSL claim untouched — would be a real bug to clobber
    expect(newLeagues.kcsl).toBe("captain:team_kc");
  });

  it("rejects captain grant without teamId", async () => {
    mockState.users.set("alice@example.com", {
      uid: "uid_alice",
      email: "alice@example.com",
    });
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        email: "alice@example.com",
        role: "captain",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects captain grant with malformed teamId", async () => {
    mockState.users.set("alice@example.com", {
      uid: "uid_alice",
      email: "alice@example.com",
    });
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        email: "alice@example.com",
        role: "captain",
        teamId: "Team A!", // spaces, capital, exclamation
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("/api/admin-grant-claim — admin + remove flows", () => {
  it("grants admin role", async () => {
    mockState.users.set("alice@example.com", {
      uid: "uid_alice",
      email: "alice@example.com",
    });
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        email: "alice@example.com",
        role: "admin",
      }),
    );
    expect(res.status).toBe(200);
    const newLeagues = mockState.setClaimsCalls[0]!.claims.leagues as Record<
      string,
      string
    >;
    expect(newLeagues.sfbl).toBe("admin");
  });

  it("removes claim by deleting just this league's entry", async () => {
    mockState.users.set("bob@example.com", {
      uid: "uid_bob",
      email: "bob@example.com",
      customClaims: {
        leagues: { sfbl: "captain:team_a", kcsl: "captain:team_kc" },
      },
    });
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        email: "bob@example.com",
        role: "remove",
      }),
    );
    expect(res.status).toBe(200);
    const newLeagues = mockState.setClaimsCalls[0]!.claims.leagues as Record<
      string,
      string
    >;
    expect(newLeagues.sfbl).toBeUndefined();
    expect(newLeagues.kcsl).toBe("captain:team_kc");
  });
});

describe("/api/admin-grant-claim — guards", () => {
  it("404s when target email has no auth account yet", async () => {
    // No user added to mockState.users
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        email: "ghost@example.com",
        role: "captain",
        teamId: "team_a",
      }),
    );
    expect(res.status).toBe(404);
    const data = (await res.json()) as { error: string };
    expect(data.error).toMatch(/sign in via magic link/i);
  });

  it("self-demote guard prevents admin from removing own role", async () => {
    mockState.users.set("admin@example.com", {
      uid: "uid_admin",
      email: "admin@example.com",
      customClaims: { leagues: { sfbl: "admin" } },
    });
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        email: "admin@example.com",
        role: "remove",
      }),
    );
    expect(res.status).toBe(400);
    expect(mockState.setClaimsCalls).toHaveLength(0);
  });

  it("self can re-grant own admin (no-op but allowed)", async () => {
    mockState.users.set("admin@example.com", {
      uid: "uid_admin",
      email: "admin@example.com",
      customClaims: { leagues: { sfbl: "admin" } },
    });
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        email: "admin@example.com",
        role: "admin",
      }),
    );
    expect(res.status).toBe(200);
  });
});
