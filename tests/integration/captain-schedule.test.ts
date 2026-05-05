// Integration tests for /api/captain-schedule — captains reschedule
// their team's games (rainouts, field swaps, postponements). Every
// edit writes to /audit so commissioners can answer "who moved that
// game?". Push triggers fire on status flips (rainouts) and on
// visible date/field changes (schedule updates) per DVSL spec §5.4
// and §5.5.
//
// Why this needs hard test coverage:
//   1. Captain claims are scoped to a specific team; we must reject
//      captains who are NOT in the matchup
//   2. Audit entries must always be written or the commissioner has
//      no way to debug schedule churn
//   3. Push triggers must NOT fire on no-op edits (e.g. status set
//      to its current value), or captains will get spammed
//   4. The endpoint must reject status values outside the allowed set

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface DocState {
  data: Record<string, unknown>;
}

const mockState = {
  decoded: {
    uid: "uid_captain",
    leagues: { sfbl: "captain:team_a" } as Record<string, string>,
  } as { uid: string; leagues?: Record<string, string> },
  // Firestore docs keyed by full path.
  docs: new Map<string, DocState>(),
  // Captured set/merge writes on /games/{id}.
  setCalls: [] as Array<{
    path: string;
    data: Record<string, unknown>;
    merge: boolean;
  }>,
  // Captured /audit add() writes.
  auditAdds: [] as Array<{ path: string; data: Record<string, unknown> }>,
  // Captured fanoutPush calls.
  fanoutCalls: [] as Array<{
    category: string;
    title: string;
    body: string;
    teams?: string[];
    url?: string;
  }>,
  // Failure-mode toggles.
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
    doc: (path: string) => ({
      get: async () => {
        const ds = mockState.docs.get(path);
        return {
          exists: ds != null,
          data: () => ds?.data ?? {},
        };
      },
      set: async (
        data: Record<string, unknown>,
        opts?: { merge?: boolean },
      ) => {
        const merge = opts?.merge === true;
        mockState.setCalls.push({ path, data, merge });
        const existing = mockState.docs.get(path)?.data ?? {};
        mockState.docs.set(path, {
          data: merge ? { ...existing, ...data } : data,
        });
      },
    }),
    collection: (path: string) => ({
      get: async () => {
        const docs: Array<{ id: string; data: () => Record<string, unknown> }> =
          [];
        for (const [docPath, state] of mockState.docs) {
          if (
            docPath.startsWith(path + "/") &&
            !docPath.slice(path.length + 1).includes("/")
          ) {
            const id = docPath.slice(path.length + 1);
            docs.push({ id, data: () => state.data });
          }
        }
        return { docs };
      },
      add: async (data: Record<string, unknown>) => {
        mockState.auditAdds.push({ path, data });
        return { id: "auto_" + mockState.auditAdds.length };
      },
    }),
  }),
  getAdminMessaging: () => ({}),
}));

vi.mock("@/lib/notifications/server-fanout", () => ({
  fanoutPush: vi.fn(
    async (opts: {
      category: string;
      title: string;
      body: string;
      teams?: string[];
      url?: string;
    }) => {
      mockState.fanoutCalls.push({
        category: opts.category,
        title: opts.title,
        body: opts.body,
        teams: opts.teams,
        url: opts.url,
      });
    },
  ),
  originFromRequest: () => "http://test",
}));

const { POST } = await import("@/app/api/captain-schedule/route");

function makeReq(body: Record<string, unknown>): Request {
  return new Request("http://test/api/captain-schedule", {
    method: "POST",
    headers: {
      authorization: "Bearer fake",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function setDoc(path: string, data: Record<string, unknown>) {
  mockState.docs.set(path, { data });
}

beforeEach(() => {
  mockState.decoded = {
    uid: "uid_captain",
    leagues: { sfbl: "captain:team_a" },
  };
  mockState.docs = new Map();
  mockState.setCalls = [];
  mockState.auditAdds = [];
  mockState.fanoutCalls = [];
  mockState.verifyThrows = false;

  // Default fixture: 1 game between team_a (away) and team_b (home).
  setDoc("leagues/sfbl/games/g1", {
    home_team_id: "team_b",
    away_team_id: "team_a",
    status: "scheduled",
    date: "2026-05-10T18:00:00",
    field: "Field 1",
  });
  setDoc("leagues/sfbl/teams/team_a", { name: "Yankees" });
  setDoc("leagues/sfbl/teams/team_b", { name: "Red Sox" });
});

afterEach(() => vi.clearAllMocks());

// ── auth + authorization ──────────────────────────────────────────

describe("/api/captain-schedule — auth", () => {
  it("rejects missing bearer", async () => {
    const req = new Request("http://test/api/captain-schedule", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        leagueId: "sfbl",
        gameId: "g1",
        date: "2026-05-12",
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("rejects expired/invalid token", async () => {
    mockState.verifyThrows = true;
    const res = await POST(
      makeReq({ leagueId: "sfbl", gameId: "g1", date: "2026-05-12" }),
    );
    expect(res.status).toBe(401);
    expect(mockState.setCalls).toHaveLength(0);
    expect(mockState.auditAdds).toHaveLength(0);
  });

  it("rejects callers with no league claim", async () => {
    mockState.decoded.leagues = {};
    const res = await POST(
      makeReq({ leagueId: "sfbl", gameId: "g1", date: "2026-05-12" }),
    );
    expect(res.status).toBe(403);
  });

  it("rejects callers with player-only claim", async () => {
    mockState.decoded.leagues = { sfbl: "player:p1" };
    const res = await POST(
      makeReq({ leagueId: "sfbl", gameId: "g1", date: "2026-05-12" }),
    );
    expect(res.status).toBe(403);
  });

  it("rejects captain of a DIFFERENT team (not in this matchup)", async () => {
    mockState.decoded.leagues = { sfbl: "captain:team_c" };
    const res = await POST(
      makeReq({ leagueId: "sfbl", gameId: "g1", date: "2026-05-12" }),
    );
    expect(res.status).toBe(403);
    expect(mockState.setCalls).toHaveLength(0);
    expect(mockState.auditAdds).toHaveLength(0);
  });

  it("accepts captain of the AWAY team", async () => {
    mockState.decoded.leagues = { sfbl: "captain:team_a" };
    const res = await POST(
      makeReq({ leagueId: "sfbl", gameId: "g1", date: "2026-05-12" }),
    );
    expect(res.status).toBe(200);
  });

  it("accepts captain of the HOME team", async () => {
    mockState.decoded.leagues = { sfbl: "captain:team_b" };
    const res = await POST(
      makeReq({ leagueId: "sfbl", gameId: "g1", date: "2026-05-12" }),
    );
    expect(res.status).toBe(200);
  });

  it("accepts admin even when not in matchup", async () => {
    mockState.decoded.leagues = { sfbl: "admin" };
    const res = await POST(
      makeReq({ leagueId: "sfbl", gameId: "g1", date: "2026-05-12" }),
    );
    expect(res.status).toBe(200);
  });
});

// ── body validation ───────────────────────────────────────────────

describe("/api/captain-schedule — body validation", () => {
  it("400 on malformed JSON", async () => {
    const req = new Request("http://test/api/captain-schedule", {
      method: "POST",
      headers: {
        authorization: "Bearer fake",
        "content-type": "application/json",
      },
      body: "{not json",
    });
    expect((await POST(req)).status).toBe(400);
  });

  it("400 missing leagueId", async () => {
    const res = await POST(makeReq({ gameId: "g1", date: "2026-05-12" }));
    expect(res.status).toBe(400);
  });

  it("400 missing gameId", async () => {
    const res = await POST(makeReq({ leagueId: "sfbl", date: "2026-05-12" }));
    expect(res.status).toBe(400);
  });

  it("404 when game doesn't exist", async () => {
    const res = await POST(
      makeReq({ leagueId: "sfbl", gameId: "ghost", date: "2026-05-12" }),
    );
    expect(res.status).toBe(404);
    expect(mockState.setCalls).toHaveLength(0);
    expect(mockState.auditAdds).toHaveLength(0);
  });

  it("400 when no editable fields present", async () => {
    // Body has leagueId+gameId but no date/field/status.
    const res = await POST(makeReq({ leagueId: "sfbl", gameId: "g1" }));
    expect(res.status).toBe(400);
  });

  it("400 when only status is present and it's not in the allowed set", async () => {
    // ALLOWED_STATUS doesn't include 'garbage' — so update.status
    // never gets set, and update is empty after parse → 400.
    const res = await POST(
      makeReq({ leagueId: "sfbl", gameId: "g1", status: "garbage" }),
    );
    expect(res.status).toBe(400);
  });
});

// ── update logic ──────────────────────────────────────────────────

describe("/api/captain-schedule — update writes", () => {
  it("date update is persisted to /games/{id}", async () => {
    await POST(
      makeReq({ leagueId: "sfbl", gameId: "g1", date: "2026-05-17T18:00:00" }),
    );
    const gameWrite = mockState.setCalls.find(
      (c) => c.path === "leagues/sfbl/games/g1",
    );
    expect(gameWrite).toBeDefined();
    expect(gameWrite!.merge).toBe(true);
    expect(gameWrite!.data.date).toBe("2026-05-17T18:00:00");
    expect(gameWrite!.data.updated_by_uid).toBe("uid_captain");
    expect(gameWrite!.data.updated_at).toBeTruthy();
  });

  it("field update is persisted + trimmed", async () => {
    await POST(
      makeReq({ leagueId: "sfbl", gameId: "g1", field: "  Field 7  " }),
    );
    const gameWrite = mockState.setCalls.find(
      (c) => c.path === "leagues/sfbl/games/g1",
    );
    expect(gameWrite!.data.field).toBe("Field 7");
  });

  it("status update accepts valid status (postponed)", async () => {
    await POST(
      makeReq({ leagueId: "sfbl", gameId: "g1", status: "postponed" }),
    );
    const gameWrite = mockState.setCalls.find(
      (c) => c.path === "leagues/sfbl/games/g1",
    );
    expect(gameWrite!.data.status).toBe("postponed");
  });

  it("clearing date with empty string sets to null", async () => {
    await POST(makeReq({ leagueId: "sfbl", gameId: "g1", date: "" }));
    const gameWrite = mockState.setCalls.find(
      (c) => c.path === "leagues/sfbl/games/g1",
    );
    expect(gameWrite!.data.date).toBeNull();
  });

  it("multiple fields in one call all merge into one game write", async () => {
    await POST(
      makeReq({
        leagueId: "sfbl",
        gameId: "g1",
        date: "2026-05-17T18:00:00",
        field: "Field 7",
        status: "scheduled",
      }),
    );
    const gameWrites = mockState.setCalls.filter(
      (c) => c.path === "leagues/sfbl/games/g1",
    );
    expect(gameWrites).toHaveLength(1);
    expect(gameWrites[0]!.data.date).toBe("2026-05-17T18:00:00");
    expect(gameWrites[0]!.data.field).toBe("Field 7");
    expect(gameWrites[0]!.data.status).toBe("scheduled");
  });
});

// ── audit log ─────────────────────────────────────────────────────

describe("/api/captain-schedule — audit log", () => {
  it("appends an audit entry on every successful edit", async () => {
    await POST(
      makeReq({ leagueId: "sfbl", gameId: "g1", date: "2026-05-17T18:00:00" }),
    );
    expect(mockState.auditAdds).toHaveLength(1);
    const entry = mockState.auditAdds[0]!;
    expect(entry.path).toBe("leagues/sfbl/audit");
    expect(entry.data.kind).toBe("schedule_edit");
    expect(entry.data.game_id).toBe("g1");
    expect(entry.data.by_uid).toBe("uid_captain");
    expect(entry.data.by_role).toBe("captain");
    expect(entry.data.at).toBeTruthy();
    expect(
      (entry.data.changes as Record<string, unknown>).date,
    ).toBe("2026-05-17T18:00:00");
  });

  it("audit entry tags admin edits with by_role=admin", async () => {
    mockState.decoded.leagues = { sfbl: "admin" };
    await POST(
      makeReq({ leagueId: "sfbl", gameId: "g1", date: "2026-05-17T18:00:00" }),
    );
    expect(mockState.auditAdds[0]!.data.by_role).toBe("admin");
  });

  it("does NOT write audit entry when validation fails (404, 403, 400)", async () => {
    // 404
    await POST(
      makeReq({ leagueId: "sfbl", gameId: "ghost", date: "2026-05-12" }),
    );
    // 403 — captain of wrong team
    mockState.decoded.leagues = { sfbl: "captain:team_c" };
    await POST(
      makeReq({ leagueId: "sfbl", gameId: "g1", date: "2026-05-12" }),
    );
    // 400 — no editable fields
    mockState.decoded.leagues = { sfbl: "captain:team_a" };
    await POST(makeReq({ leagueId: "sfbl", gameId: "g1" }));

    expect(mockState.auditAdds).toHaveLength(0);
  });
});

// ── push triggers ─────────────────────────────────────────────────

describe("/api/captain-schedule — push triggers", () => {
  it("fires rainouts push when status flips to 'postponed'", async () => {
    await POST(
      makeReq({ leagueId: "sfbl", gameId: "g1", status: "postponed" }),
    );
    const ppd = mockState.fanoutCalls.find((c) => c.category === "rainouts");
    expect(ppd).toBeDefined();
    expect(ppd!.title).toContain("PPD");
    expect(ppd!.title).toContain("Yankees");
    expect(ppd!.title).toContain("Red Sox");
    expect(ppd!.url).toBe("/schedule");
    expect(ppd!.teams).toEqual(["team_a", "team_b"]);
  });

  it("fires rainouts push when status flips to 'cancelled'", async () => {
    await POST(
      makeReq({ leagueId: "sfbl", gameId: "g1", status: "cancelled" }),
    );
    const cancel = mockState.fanoutCalls.find(
      (c) => c.category === "rainouts",
    );
    expect(cancel!.title).toContain("Cancelled");
  });

  it("fires schedule push when date changes", async () => {
    await POST(
      makeReq({ leagueId: "sfbl", gameId: "g1", date: "2026-05-17T18:00:00" }),
    );
    const sched = mockState.fanoutCalls.find(
      (c) => c.category === "schedule",
    );
    expect(sched).toBeDefined();
    expect(sched!.body).toContain("date");
    expect(sched!.url).toBe("/schedule");
  });

  it("fires schedule push when field changes", async () => {
    await POST(
      makeReq({ leagueId: "sfbl", gameId: "g1", field: "Field 7" }),
    );
    const sched = mockState.fanoutCalls.find(
      (c) => c.category === "schedule",
    );
    expect(sched).toBeDefined();
    expect(sched!.body).toContain("field");
  });

  it("fires ONE schedule push when both date and field change", async () => {
    await POST(
      makeReq({
        leagueId: "sfbl",
        gameId: "g1",
        date: "2026-05-17T18:00:00",
        field: "Field 7",
      }),
    );
    const scheds = mockState.fanoutCalls.filter(
      (c) => c.category === "schedule",
    );
    expect(scheds).toHaveLength(1);
    expect(scheds[0]!.body).toContain("date");
    expect(scheds[0]!.body).toContain("field");
  });

  it("does NOT fire push when status is set to its current value (no-op)", async () => {
    // Game is already 'scheduled'; setting to 'scheduled' is a no-op.
    // Audit still writes (we logged the attempt) but no push fires
    // because the user-visible state didn't change.
    await POST(
      makeReq({ leagueId: "sfbl", gameId: "g1", status: "scheduled" }),
    );
    expect(mockState.fanoutCalls).toHaveLength(0);
  });

  it("does NOT fire push when date is set to its current value", async () => {
    // Pre-existing game date is 2026-05-10T18:00:00.
    await POST(
      makeReq({
        leagueId: "sfbl",
        gameId: "g1",
        date: "2026-05-10T18:00:00",
      }),
    );
    expect(mockState.fanoutCalls).toHaveLength(0);
  });

  it("does NOT fire push when field is set to its current value", async () => {
    await POST(
      makeReq({ leagueId: "sfbl", gameId: "g1", field: "Field 1" }),
    );
    expect(mockState.fanoutCalls).toHaveLength(0);
  });
});
