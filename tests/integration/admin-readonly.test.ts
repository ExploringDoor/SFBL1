// Integration tests for the two admin read-only endpoints:
//   - GET /api/admin-league-health (counts dashboard)
//   - GET /api/admin-audit-log     (recent audit entries with email enrichment)
//
// Both gate on `admin` claim for the target league. Read-only but
// they enrich data via Admin SDK (Firebase Auth lookups for
// uid→email), so they need the same multi-tenant scoping discipline
// as write endpoints.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface DocEntry {
  id: string;
  data: Record<string, unknown>;
}

const mockState = {
  decoded: {
    uid: "uid_admin",
    leagues: { sfbl: "admin" } as Record<string, string>,
  } as { uid: string; leagues?: Record<string, string> },
  // Mock Firestore — keyed by collection path → list of {id, data}
  collections: new Map<string, DocEntry[]>(),
  // Mock Firebase Auth users keyed by uid.
  users: new Map<string, { uid: string; email?: string }>(),
};

vi.mock("@/lib/firebase-admin", () => ({
  getAdminAuth: () => ({
    verifyIdToken: vi.fn(async () => mockState.decoded),
    getUsers: vi.fn(
      async (refs: Array<{ uid: string }>) => ({
        users: refs
          .map((r) => mockState.users.get(r.uid))
          .filter((u): u is { uid: string; email?: string } => u != null),
      }),
    ),
  }),
  getAdminDb: () => ({
    collection: (path: string) => {
      const docs = mockState.collections.get(path) ?? [];
      // Returns a chainable that supports .where().get() and .get().
      const baseQuery = (filters: Array<[string, string, unknown]>) => {
        const filtered = docs.filter((d) =>
          filters.every(([field, op, value]) => {
            if (op === "==") return d.data[field] === value;
            if (op === ">=") return (d.data[field] as string) >= (value as string);
            if (op === "in") {
              return (
                Array.isArray(value) &&
                (value as unknown[]).includes(d.data[field])
              );
            }
            return true;
          }),
        );
        return {
          where: (f: string, op: string, v: unknown) =>
            baseQuery([...filters, [f, op, v]]),
          get: async () => ({
            size: filtered.length,
            docs: filtered.map((d) => ({
              id: d.id,
              data: () => d.data,
            })),
          }),
        };
      };
      return baseQuery([]);
    },
    doc: (path: string) => ({
      get: async () => {
        // Support /_private/contact subdoc reads — admin-league-health
        // walks players + their contact docs to count emails.
        // Tests can pre-seed contacts via mockState.collections, with
        // path "leagues/{l}/players/{pid}/_private" → list of contact
        // docs. For tests that don't need contact data, just return
        // empty.
        const m = path.match(
          /^leagues\/([^/]+)\/players\/([^/]+)\/_private\/(.+)$/,
        );
        if (m) {
          const subPath = `leagues/${m[1]}/players/${m[2]}/_private`;
          const docs = mockState.collections.get(subPath) ?? [];
          const found = docs.find((d) => d.id === m[3]);
          if (found) return { exists: true, data: () => found.data };
        }
        return { exists: false, data: () => ({}) };
      },
    }),
  }),
  getAdminMessaging: () => ({}),
}));

const { GET: healthGet } = await import(
  "@/app/api/admin-league-health/route"
);
const { GET: auditGet } = await import(
  "@/app/api/admin-audit-log/route"
);

function makeGet(url: string): Request {
  return new Request(url, {
    method: "GET",
    headers: { authorization: "Bearer fake" },
  });
}

beforeEach(() => {
  mockState.decoded = {
    uid: "uid_admin",
    leagues: { sfbl: "admin" },
  };
  mockState.collections = new Map();
  mockState.users = new Map();
});

afterEach(() => vi.clearAllMocks());

// ── league-health ──────────────────────────────────────────────────

describe("/api/admin-league-health — auth", () => {
  it("rejects callers without admin claim", async () => {
    mockState.decoded.leagues = { sfbl: "captain:team_a" };
    const res = await healthGet(
      makeGet("http://test/api/admin-league-health?leagueId=sfbl"),
    );
    expect(res.status).toBe(403);
  });

  it("requires leagueId query param", async () => {
    const res = await healthGet(
      makeGet("http://test/api/admin-league-health"),
    );
    expect(res.status).toBe(400);
  });
});

describe("/api/admin-league-health — counts", () => {
  it("returns counts for teams + players + games + subscribers", async () => {
    mockState.collections.set("leagues/sfbl/teams", [
      { id: "team_a", data: { name: "Team A", active: true } },
      { id: "team_b", data: { name: "Team B", active: true } },
      { id: "team_c", data: { name: "Old Team", active: false } },
    ]);
    // Post-PII: email lives on /_private/contact subdocs. Seed
    // both the public doc and the contact subdoc for players that
    // should have email.
    mockState.collections.set("leagues/sfbl/players", [
      {
        id: "p1",
        data: {
          name: "P1",
          team_id: "team_a",
          active: true,
          auth_uid: "uid_p1",
        },
      },
      {
        id: "p2",
        data: {
          name: "P2",
          team_id: "team_a",
          active: true,
        },
      },
      {
        id: "p3",
        data: {
          name: "P3",
          team_id: "team_b",
          active: true,
          // no contact subdoc — counts as no-email
        },
      },
    ]);
    // Contact subdocs for p1 and p2 (post-PII storage).
    mockState.collections.set("leagues/sfbl/players/p1/_private", [
      { id: "contact", data: { email: "p1@example.com" } },
    ]);
    mockState.collections.set("leagues/sfbl/players/p2/_private", [
      { id: "contact", data: { email: "p2@example.com" } },
    ]);
    mockState.collections.set("leagues/sfbl/games", [
      { id: "g1", data: { status: "final", updated_at: "2026-05-01" } },
      { id: "g2", data: { status: "final", updated_at: "2026-05-01" } },
      { id: "g3", data: { status: "scheduled" } },
      { id: "g4", data: { status: "postponed" } },
    ]);
    mockState.collections.set("notification_tokens", [
      {
        id: "tok1",
        data: {
          leagueId: "sfbl",
          is_captain_authed: true,
        },
      },
      {
        id: "tok2",
        data: {
          leagueId: "sfbl",
          is_admin: true,
        },
      },
      {
        id: "tok3",
        data: {
          leagueId: "kcsl", // different league — must NOT count
        },
      },
    ]);
    mockState.collections.set("leagues/sfbl/audit", []);

    const res = await healthGet(
      makeGet("http://test/api/admin-league-health?leagueId=sfbl"),
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.teams).toMatchObject({ active: 2, total: 3 });
    expect(data.players).toMatchObject({
      active: 3,
      total: 3,
      with_email: 2,
      linked_to_auth: 1,
    });
    expect(data.games).toMatchObject({
      total: 4,
      scheduled: 1,
      final: 2,
      postponed: 1,
    });
    expect(data.subscribers).toMatchObject({
      devices: 2, // sfbl-scoped only — kcsl token excluded
      captain_authed: 1,
      admin: 1,
    });
  });
});

// ── audit-log ──────────────────────────────────────────────────────

describe("/api/admin-audit-log — auth", () => {
  it("rejects callers without admin claim", async () => {
    mockState.decoded.leagues = { sfbl: "captain:team_a" };
    const res = await auditGet(
      makeGet("http://test/api/admin-audit-log?leagueId=sfbl"),
    );
    expect(res.status).toBe(403);
  });

  it("requires leagueId query param", async () => {
    const res = await auditGet(
      makeGet("http://test/api/admin-audit-log"),
    );
    expect(res.status).toBe(400);
  });
});

describe("/api/admin-audit-log — entries", () => {
  it("returns entries sorted newest-first with email enrichment", async () => {
    mockState.users.set("uid_alice", {
      uid: "uid_alice",
      email: "alice@example.com",
    });
    mockState.collections.set("leagues/sfbl/audit", [
      {
        id: "a1",
        data: {
          kind: "schedule_edit",
          by_uid: "uid_alice",
          by_role: "captain",
          game_id: "g1",
          changes: { date: "2026-05-15" },
          at: "2026-05-04T18:00:00Z",
        },
      },
      {
        id: "a2",
        data: {
          kind: "schedule_edit",
          by_uid: "uid_unknown", // no auth user → falls back to raw uid
          game_id: "g2",
          changes: {},
          at: "2026-05-04T19:00:00Z",
        },
      },
    ]);
    const res = await auditGet(
      makeGet("http://test/api/admin-audit-log?leagueId=sfbl"),
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      items: Array<{ id: string; by_email: string | null; at: string }>;
    };
    expect(data.items).toHaveLength(2);
    // Newest first.
    expect(data.items[0]!.id).toBe("a2");
    expect(data.items[1]!.id).toBe("a1");
    // Enriched email
    expect(data.items[1]!.by_email).toBe("alice@example.com");
    // Unenrichable falls back to null
    expect(data.items[0]!.by_email).toBeNull();
  });

  it("filters by kind when ?kind=X passed", async () => {
    mockState.collections.set("leagues/sfbl/audit", [
      {
        id: "a1",
        data: {
          kind: "schedule_edit",
          by_uid: "u",
          at: "2026-05-04T18:00:00Z",
        },
      },
      {
        id: "a2",
        data: {
          kind: "claim_grant",
          by_uid: "u",
          at: "2026-05-04T19:00:00Z",
        },
      },
    ]);
    const res = await auditGet(
      makeGet(
        "http://test/api/admin-audit-log?leagueId=sfbl&kind=schedule_edit",
      ),
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as { items: Array<{ id: string }> };
    expect(data.items).toHaveLength(1);
    expect(data.items[0]!.id).toBe("a1");
  });

  it("respects limit query param (caps at 500)", async () => {
    const lots: DocEntry[] = [];
    for (let i = 0; i < 50; i++) {
      lots.push({
        id: `a${i}`,
        data: {
          kind: "schedule_edit",
          by_uid: "u",
          at: `2026-05-04T${String(i).padStart(2, "0")}:00:00Z`,
        },
      });
    }
    mockState.collections.set("leagues/sfbl/audit", lots);
    const res = await auditGet(
      makeGet("http://test/api/admin-audit-log?leagueId=sfbl&limit=5"),
    );
    const data = (await res.json()) as { items: unknown[] };
    expect(data.items).toHaveLength(5);
  });
});
