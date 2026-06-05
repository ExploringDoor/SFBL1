// Integration tests for /api/public-captain-claim — focused on the
// per-team captain password security model (Adam, 2026-05-18).
//
// The invariant under test: once a team has a captain password set,
// it is STRICT — only that exact password mints the captain token.
// The team name / abbrev / id no longer work, and there is no
// no-password bypass. Teams WITHOUT a password keep the lenient
// "trust the URL / name works" behavior (LBDC) so the change is
// opt-in per team.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockState = {
  // Firestore docs keyed by full path → data (undefined = missing).
  docs: new Map<string, Record<string, unknown>>(),
  audits: [] as Record<string, unknown>[],
};

vi.mock("@/lib/firebase-admin", () => ({
  getAdminAuth: () => ({
    createCustomToken: vi.fn(async (uid: string) => `token-for-${uid}`),
  }),
  getAdminDb: () => ({
    doc: (path: string) => ({
      get: async () => {
        const data = mockState.docs.get(path);
        return { exists: data != null, data: () => data ?? {} };
      },
    }),
    collection: (path: string) => ({
      add: async (rec: Record<string, unknown>) => {
        mockState.audits.push({ path, ...rec });
      },
    }),
  }),
}));

const { POST } = await import("@/app/api/public-captain-claim/route");

function makeReq(body: Record<string, unknown>): Request {
  return new Request("http://test/api/public-captain-claim", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "203.0.113.5",
    },
    body: JSON.stringify(body),
  });
}

const LEAGUE = "sfbl";

beforeEach(() => {
  mockState.docs = new Map();
  mockState.audits = [];
  // League opted into passwordless captain mode.
  mockState.docs.set(`leagues/${LEAGUE}`, {
    captain: { passwordless: true },
  });
});

afterEach(() => vi.clearAllMocks());

function setTeam(
  teamId: string,
  opts: { name: string; password?: string },
) {
  mockState.docs.set(`leagues/${LEAGUE}/teams/${teamId}`, {
    name: opts.name,
    has_captain_password: opts.password ? true : undefined,
  });
  if (opts.password) {
    mockState.docs.set(
      `leagues/${LEAGUE}/teams/${teamId}/_private/auth`,
      { captain_password: opts.password },
    );
  }
}

describe("public-captain-claim — team WITH a password (strict)", () => {
  beforeEach(() => {
    setTeam("miami_yankees", {
      name: "Miami Yankees",
      password: "yankees47",
    });
  });

  it("accepts the exact password", async () => {
    const res = await POST(
      makeReq({
        leagueId: LEAGUE,
        teamId: "miami_yankees",
        teamPassword: "yankees47",
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok?: boolean; customToken?: string };
    expect(body.ok).toBe(true);
    expect(body.customToken).toContain("public-captain:sfbl:miami_yankees");
  });

  it("is case/space forgiving on the real password", async () => {
    const res = await POST(
      makeReq({
        leagueId: LEAGUE,
        teamId: "miami_yankees",
        teamPassword: "Yankees 47",
      }),
    );
    expect(res.status).toBe(200);
  });

  it("REJECTS the team name as the password", async () => {
    const res = await POST(
      makeReq({
        leagueId: LEAGUE,
        teamId: "miami_yankees",
        teamPassword: "Miami Yankees",
      }),
    );
    expect(res.status).toBe(401);
  });

  it("REJECTS no password at all (bypass closed)", async () => {
    const res = await POST(
      makeReq({ leagueId: LEAGUE, teamId: "miami_yankees" }),
    );
    expect(res.status).toBe(401);
  });

  it("REJECTS a wrong password", async () => {
    const res = await POST(
      makeReq({
        leagueId: LEAGUE,
        teamId: "miami_yankees",
        teamPassword: "yankees99",
      }),
    );
    expect(res.status).toBe(401);
  });
});

describe("public-captain-claim — team WITHOUT a password (lenient)", () => {
  beforeEach(() => {
    setTeam("broward_senators", { name: "Broward Senators" });
  });

  it("accepts the team name as the password (legacy convenience)", async () => {
    const res = await POST(
      makeReq({
        leagueId: LEAGUE,
        teamId: "broward_senators",
        teamPassword: "Broward Senators",
      }),
    );
    expect(res.status).toBe(200);
  });

  it("accepts no password (trust-the-URL still works when unset)", async () => {
    const res = await POST(
      makeReq({ leagueId: LEAGUE, teamId: "broward_senators" }),
    );
    expect(res.status).toBe(200);
  });
});

describe("public-captain-claim — gate", () => {
  it("403s when the league has not enabled passwordless captain", async () => {
    mockState.docs.set(`leagues/${LEAGUE}`, { captain: {} });
    setTeam("miami_yankees", { name: "Miami Yankees", password: "yankees47" });
    const res = await POST(
      makeReq({
        leagueId: LEAGUE,
        teamId: "miami_yankees",
        teamPassword: "yankees47",
      }),
    );
    expect(res.status).toBe(403);
  });
});
