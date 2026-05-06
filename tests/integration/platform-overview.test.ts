// Integration tests for /api/_platform-overview.
//
// Platform-admin-only data feed. Returns every tenant + recent /errors
// across the whole platform — the data behind /_platform.
//
// Auth posture: bearer token + UID must be in PLATFORM_ADMIN_UIDS env
// var. A regular tenant admin (claim leagues.{slug} == 'admin') is
// NOT enough — that scopes to one tenant; this endpoint shows all.

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

interface DocEntry {
  id: string;
  data: Record<string, unknown>;
}

const mockState = {
  decoded: {
    uid: "uid_platform_admin",
    leagues: {} as Record<string, string>,
  } as { uid: string; leagues?: Record<string, string> },
  // Firestore: collection path → list of {id, data}
  collections: new Map<string, DocEntry[]>(),
  verifyThrows: false,
};

vi.mock("@/lib/firebase-admin", () => ({
  getAdminAuth: () => ({
    verifyIdToken: vi.fn(async () => {
      if (mockState.verifyThrows) throw new Error("token expired");
      return mockState.decoded;
    }),
  }),
  getAdminDb: () => ({
    collection: (path: string) => ({
      get: async () => {
        const docs = mockState.collections.get(path) ?? [];
        return {
          size: docs.length,
          docs: docs.map((d) => ({
            id: d.id,
            data: () => d.data,
          })),
        };
      },
    }),
  }),
}));

const { GET } = await import("@/app/api/_platform-overview/route");

function makeReq(): Request {
  return new Request("http://test/api/_platform-overview", {
    method: "GET",
    headers: { authorization: "Bearer fake" },
  });
}

const ORIGINAL_PLATFORM_ADMIN_UIDS = process.env.PLATFORM_ADMIN_UIDS;

beforeEach(() => {
  mockState.decoded = {
    uid: "uid_platform_admin",
    leagues: {},
  };
  mockState.collections = new Map();
  mockState.verifyThrows = false;
  process.env.PLATFORM_ADMIN_UIDS = "uid_platform_admin,uid_other_admin";
});

afterEach(() => {
  vi.clearAllMocks();
  if (ORIGINAL_PLATFORM_ADMIN_UIDS === undefined) {
    delete process.env.PLATFORM_ADMIN_UIDS;
  } else {
    process.env.PLATFORM_ADMIN_UIDS = ORIGINAL_PLATFORM_ADMIN_UIDS;
  }
});

// ── auth ─────────────────────────────────────────────────────────

describe("/api/_platform-overview — auth", () => {
  it("401 missing bearer", async () => {
    const req = new Request("http://test/api/_platform-overview", {
      method: "GET",
    });
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("401 expired/invalid token", async () => {
    mockState.verifyThrows = true;
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
  });

  it("403 for caller whose UID isn't in PLATFORM_ADMIN_UIDS", async () => {
    mockState.decoded.uid = "some_other_uid";
    const res = await GET(makeReq());
    expect(res.status).toBe(403);
  });

  it("403 even when caller has admin claim for a tenant", async () => {
    // Per-tenant admin claim is NOT platform admin — this endpoint
    // shows data across every tenant.
    mockState.decoded = {
      uid: "uid_tenant_admin",
      leagues: { sfbl: "admin" },
    };
    const res = await GET(makeReq());
    expect(res.status).toBe(403);
  });

  it("403 when PLATFORM_ADMIN_UIDS env is unset (fail closed)", async () => {
    delete process.env.PLATFORM_ADMIN_UIDS;
    const res = await GET(makeReq());
    expect(res.status).toBe(403);
  });

  it("403 when env is empty string (fail closed)", async () => {
    process.env.PLATFORM_ADMIN_UIDS = "";
    const res = await GET(makeReq());
    expect(res.status).toBe(403);
  });

  it("200 for any UID listed in the comma-separated env (multi-admin)", async () => {
    mockState.decoded.uid = "uid_other_admin";
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
  });
});

// ── tenants payload ──────────────────────────────────────────────

describe("/api/_platform-overview — tenants", () => {
  it("returns empty arrays when there are no leagues", async () => {
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      tenants: unknown[];
      errors: unknown[];
    };
    expect(data.tenants).toEqual([]);
    expect(data.errors).toEqual([]);
  });

  it("returns one row per league with metadata + counts", async () => {
    mockState.collections.set("leagues", [
      {
        id: "sfbl",
        data: {
          name: "South Florida Baseball",
          sport: "baseball",
          updated_at: "2026-05-04T12:00:00Z",
          billing: { status: "active", paid_through: "2026-fall" },
        },
      },
      {
        id: "kcsl",
        data: {
          name: "Kings County Softball",
          sport: "softball",
        },
      },
    ]);
    mockState.collections.set("leagues/sfbl/teams", [
      { id: "t1", data: {} },
      { id: "t2", data: {} },
      { id: "t3", data: {} },
    ]);
    mockState.collections.set("leagues/sfbl/players", [
      { id: "p1", data: {} },
      { id: "p2", data: {} },
    ]);
    mockState.collections.set("leagues/sfbl/games", [
      { id: "g1", data: {} },
    ]);
    mockState.collections.set("leagues/kcsl/teams", []);
    mockState.collections.set("leagues/kcsl/players", []);
    mockState.collections.set("leagues/kcsl/games", []);

    const res = await GET(makeReq());
    const data = (await res.json()) as {
      tenants: Array<{
        slug: string;
        name: string;
        sport: string | null;
        billing_status: string | null;
        paid_through: string | null;
        team_count: number;
        player_count: number;
        game_count: number;
        last_activity_at: string | null;
      }>;
    };
    expect(data.tenants).toHaveLength(2);
    // Sorted by slug ascending.
    expect(data.tenants.map((t) => t.slug)).toEqual(["kcsl", "sfbl"]);
    const sfbl = data.tenants.find((t) => t.slug === "sfbl")!;
    expect(sfbl.name).toBe("South Florida Baseball");
    expect(sfbl.sport).toBe("baseball");
    expect(sfbl.team_count).toBe(3);
    expect(sfbl.player_count).toBe(2);
    expect(sfbl.game_count).toBe(1);
    expect(sfbl.billing_status).toBe("active");
    expect(sfbl.paid_through).toBe("2026-fall");
    expect(sfbl.last_activity_at).toBe("2026-05-04T12:00:00Z");

    const kcsl = data.tenants.find((t) => t.slug === "kcsl")!;
    expect(kcsl.team_count).toBe(0);
    expect(kcsl.billing_status).toBeNull();
    expect(kcsl.paid_through).toBeNull();
    expect(kcsl.last_activity_at).toBeNull();
  });

  it("falls back to slug for missing name (defensive)", async () => {
    mockState.collections.set("leagues", [
      { id: "wpbc", data: {} }, // no name field
    ]);
    mockState.collections.set("leagues/wpbc/teams", []);
    mockState.collections.set("leagues/wpbc/players", []);
    mockState.collections.set("leagues/wpbc/games", []);
    const res = await GET(makeReq());
    const data = (await res.json()) as {
      tenants: Array<{ slug: string; name: string }>;
    };
    expect(data.tenants[0]!.name).toBe("wpbc");
  });
});

// ── errors payload ───────────────────────────────────────────────

describe("/api/_platform-overview — errors", () => {
  it("returns errors sorted newest-first", async () => {
    mockState.collections.set("errors", [
      {
        id: "e_old",
        data: {
          message: "older error",
          at: "2026-05-01T10:00:00Z",
          leagueId: "sfbl",
        },
      },
      {
        id: "e_new",
        data: {
          message: "newer error",
          at: "2026-05-04T20:00:00Z",
          leagueId: "kcsl",
        },
      },
    ]);
    const res = await GET(makeReq());
    const data = (await res.json()) as {
      errors: Array<{ id: string; message: string; leagueId: string }>;
    };
    expect(data.errors).toHaveLength(2);
    expect(data.errors[0]!.id).toBe("e_new");
    expect(data.errors[0]!.message).toBe("newer error");
    expect(data.errors[1]!.id).toBe("e_old");
  });

  it("caps errors at 50 (most recent)", async () => {
    const lots: DocEntry[] = [];
    for (let i = 0; i < 100; i++) {
      lots.push({
        id: `e${i}`,
        data: {
          message: `error ${i}`,
          at: `2026-05-04T${String(i % 24).padStart(2, "0")}:00:00Z`,
          leagueId: "sfbl",
        },
      });
    }
    mockState.collections.set("errors", lots);
    const res = await GET(makeReq());
    const data = (await res.json()) as { errors: unknown[] };
    expect(data.errors).toHaveLength(50);
  });

  it("falls back to '(no message)' when message field is missing", async () => {
    mockState.collections.set("errors", [
      { id: "e1", data: { at: "2026-05-04T12:00:00Z" } },
    ]);
    const res = await GET(makeReq());
    const data = (await res.json()) as {
      errors: Array<{ message: string }>;
    };
    expect(data.errors[0]!.message).toBe("(no message)");
  });

  it("uses `error` field as fallback when `message` is absent", async () => {
    mockState.collections.set("errors", [
      { id: "e1", data: { error: "from error field", at: "2026-05-04" } },
    ]);
    const res = await GET(makeReq());
    const data = (await res.json()) as {
      errors: Array<{ message: string }>;
    };
    expect(data.errors[0]!.message).toBe("from error field");
  });

  it("handles errors with no timestamp gracefully (sorted to end)", async () => {
    mockState.collections.set("errors", [
      { id: "e_undated", data: { message: "no timestamp" } },
      {
        id: "e_dated",
        data: { message: "with timestamp", at: "2026-05-04" },
      },
    ]);
    const res = await GET(makeReq());
    const data = (await res.json()) as {
      errors: Array<{ id: string }>;
    };
    expect(data.errors[0]!.id).toBe("e_dated");
    expect(data.errors[1]!.id).toBe("e_undated");
  });
});
