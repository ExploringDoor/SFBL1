// Integration tests for /api/public-admin-claim — which role a password mints.
//
// The full password always wins; a table role (Island's umpires / scheduler)
// still mints exactly the table's scopes; and a CONFIG-DEFINED role (ETBL's
// town commissioners) mints the scopes the league doc declares, narrowed by
// its town, with admin_town in the token. Ids the rules regex would not
// recognise are never minted at all.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = {
  docs: new Map<string, Record<string, unknown>>(),
  audits: [] as Record<string, unknown>[],
  tokens: [] as { uid: string; claims: Record<string, unknown> }[],
};

vi.mock("@/lib/firebase-admin", () => ({
  getAdminAuth: () => ({
    createCustomToken: vi.fn(async (uid: string, claims: Record<string, unknown>) => {
      state.tokens.push({ uid, claims });
      return `token-for-${uid}`;
    }),
  }),
  getAdminDb: () => ({
    doc: (path: string) => ({
      get: async () => {
        const data = state.docs.get(path);
        return { exists: data != null, data: () => data ?? {} };
      },
    }),
    collection: (path: string) => ({
      add: async (rec: Record<string, unknown>) => {
        state.audits.push({ path, ...rec });
      },
    }),
  }),
}));

const { POST } = await import("@/app/api/public-admin-claim/route");

// The route rate-limits per IP (20 / 10 min, module-level). Every request in
// this file uses a fresh address so the limit never shapes a result.
let ipCounter = 0;
function makeReq(body: Record<string, unknown>): Request {
  ipCounter += 1;
  return new Request("http://test/api/public-admin-claim", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `203.0.113.${ipCounter}`,
    },
    body: JSON.stringify(body),
  });
}

const L = "etbl";

function setLeague(admin: Record<string, unknown>) {
  state.docs.set(`leagues/${L}`, { slug: L, admin });
}

async function claimFor(password: string) {
  const res = await POST(makeReq({ leagueId: L, password }));
  const body = (await res.json()) as { ok?: boolean; error?: string };
  return { status: res.status, body, minted: state.tokens.at(-1) };
}

beforeEach(() => {
  state.docs = new Map();
  state.audits = [];
  state.tokens = [];
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("full password", () => {
  beforeEach(() =>
    setLeague({
      passwordless: true,
      password: "full-secret",
      roles: {
        mineola: { password: "mineola-pw", scopes: ["scores"], town: "Mineola" },
      },
    }),
  );

  it("mints the unrestricted admin, with no town", async () => {
    const r = await claimFor("full-secret");
    expect(r.status).toBe(200);
    expect(r.minted?.uid).toBe(`public-admin:${L}`);
    expect(r.minted?.claims.leagues).toEqual({ [L]: "admin" });
    expect(r.minted?.claims).not.toHaveProperty("admin_town");
    expect(r.minted?.claims).not.toHaveProperty("admin_scopes");
    expect(state.audits.at(-1)).toMatchObject({ role: "admin" });
    expect(state.audits.at(-1)).not.toHaveProperty("town");
  });

  it("wins on a tie with a role password", async () => {
    setLeague({
      passwordless: true,
      password: "same-pw",
      roles: { mineola: { password: "same-pw", scopes: ["scores"], town: "Mineola" } },
    });
    const r = await claimFor("same-pw");
    expect(r.minted?.uid).toBe(`public-admin:${L}`);
  });

  it("a wrong password is refused", async () => {
    const r = await claimFor("nope");
    expect(r.status).toBe(401);
    expect(state.tokens).toHaveLength(0);
  });
});

describe("town commissioner (config-defined role)", () => {
  it("mints the role with its scopes and admin_town, and audits the town", async () => {
    setLeague({
      passwordless: true,
      password: "full-secret",
      roles: {
        mineola: { password: "mineola-pw", scopes: ["scores", "volunteers"], town: "Mineola" },
        quitman: { password: "quitman-pw", scopes: ["scores"], town: "Quitman" },
      },
    });
    const r = await claimFor("quitman-pw");
    expect(r.status).toBe(200);
    expect(r.minted?.uid).toBe(`public-admin:${L}:quitman`);
    expect(r.minted?.claims).toMatchObject({
      leagues: { [L]: "admin:quitman" },
      admin_role: "quitman",
      admin_scopes: ["scores"],
      admin_town: "Quitman",
      public_admin: true,
    });
    expect(state.audits.at(-1)).toMatchObject({ role: "quitman", town: "Quitman" });
  });

  it("has its scopes narrowed to the town allowlist at mint time", async () => {
    setLeague({
      passwordless: true,
      password: "full-secret",
      roles: {
        mineola: {
          password: "mineola-pw",
          scopes: ["scores", "schedule", "teams"],
          town: "Mineola",
        },
      },
    });
    const r = await claimFor("mineola-pw");
    expect(r.status).toBe(200);
    expect(r.minted?.claims.admin_scopes).toEqual(["scores"]);
  });

  it("is never minted under an id the rules regex would not recognise", async () => {
    setLeague({
      passwordless: true,
      password: "full-secret",
      roles: { Mineola2: { password: "m2-pw", scopes: ["scores"], town: "Mineola" } },
    });
    const r = await claimFor("m2-pw");
    expect(r.status).toBe(401);
    expect(state.tokens).toHaveLength(0);
    expect(console.warn).toHaveBeenCalled();
  });

  it("is never minted when it would open nothing", async () => {
    setLeague({
      passwordless: true,
      password: "full-secret",
      roles: {
        noscopes: { password: "a-pw" },
        junk: { password: "b-pw", scopes: ["payments"] },
        badtown: { password: "c-pw", scopes: ["scores"], town: "x".repeat(61) },
      },
    });
    for (const pw of ["a-pw", "b-pw", "c-pw"]) {
      const r = await claimFor(pw);
      expect(r.status, pw).toBe(401);
    }
    expect(state.tokens).toHaveLength(0);
  });
});

describe("table roles (Island-shaped config) are unchanged", () => {
  it("umpires mints exactly the table's scopes, no town", async () => {
    setLeague({
      passwordless: true,
      password: "full-secret",
      roles: { umpires: { password: "ump-pw" }, scheduler: { password: "sched-pw" } },
    });
    const r = await claimFor("ump-pw");
    expect(r.status).toBe(200);
    expect(r.minted?.uid).toBe(`public-admin:${L}:umpires`);
    expect(r.minted?.claims).toMatchObject({
      admin_role: "umpires",
      admin_scopes: ["umpires"],
    });
    expect(r.minted?.claims).not.toHaveProperty("admin_town");
  });

  it("a stray scopes list on a table role is ignored", async () => {
    setLeague({
      passwordless: true,
      password: "full-secret",
      roles: { umpires: { password: "ump-pw", scopes: ["scores", "teams"] } },
    });
    const r = await claimFor("ump-pw");
    expect(r.minted?.claims.admin_scopes).toEqual(["umpires"]);
  });
});

describe("passwordless gate", () => {
  it("refuses a league that has not opted in, even with a matching role password", async () => {
    setLeague({
      roles: { mineola: { password: "mineola-pw", scopes: ["scores"], town: "Mineola" } },
    });
    const r = await claimFor("mineola-pw");
    expect(r.status).toBe(403);
    expect(state.tokens).toHaveLength(0);
  });
});
