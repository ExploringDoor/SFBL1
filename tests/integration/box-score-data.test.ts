// Tests for lib/box-score-data.ts → loadBoxScoreData.
//
// This is the data feed for /games/[gameId] and the intercepted modal
// route — the page everyone lands on after a final score because every
// push notification deep-links there. A bug here means clicking a push
// from your phone after a game ends shows a broken page.
//
// Notable failure modes we guard against:
//   - game exists but box_score doc doesn't yet (mid-flow)
//   - score_only flag must propagate so the UI hides the missing
//     individual stats with a placeholder (instead of rendering blank)
//   - lineup entries with no player_id (orphan rows from CSV imports)
//     must be filtered before reaching the UI
//   - records column ("WPBC (3-0)") computed from full season

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface DocEntry {
  id: string;
  data: Record<string, unknown>;
}

const mockState = {
  // Single docs at exact paths.
  docs: new Map<string, Record<string, unknown>>(),
  // Collection contents keyed by collection path.
  collections: new Map<string, DocEntry[]>(),
};

vi.mock("@/lib/firebase-admin", () => ({
  getAdminDb: () => ({
    doc: (path: string) => ({
      get: async () => {
        const data = mockState.docs.get(path);
        return {
          exists: data != null,
          data: () => data ?? {},
        };
      },
    }),
    collection: (path: string) => ({
      get: async () => {
        const docs = mockState.collections.get(path) ?? [];
        return {
          docs: docs.map((d) => ({ id: d.id, data: () => d.data })),
        };
      },
    }),
  }),
}));

const { loadBoxScoreData } = await import("@/lib/box-score-data");

beforeEach(() => {
  mockState.docs = new Map();
  mockState.collections = new Map();
});

afterEach(() => vi.clearAllMocks());

// ── 404 path ──────────────────────────────────────────────────────

describe("loadBoxScoreData — game-not-found", () => {
  it("returns null when the game doc doesn't exist", async () => {
    const result = await loadBoxScoreData("sfbl", "ghost", 9);
    expect(result).toBeNull();
  });
});

// ── happy path ────────────────────────────────────────────────────

describe("loadBoxScoreData — final game with full box score", () => {
  beforeEach(() => {
    mockState.docs.set("leagues/sfbl/games/g1", {
      home_team_id: "team_b",
      away_team_id: "team_a",
      home_score: 5,
      away_score: 7,
      status: "final",
      date: "2026-05-10T18:00:00",
      field: "Field 1",
    });
    mockState.docs.set("leagues/sfbl/box_scores/g1", {
      away_lineup: [
        { player_id: "p1", ab: 4, h: 2, hr: 1, rbi: 3 },
        { player_id: "p2", ab: 3, h: 1, rbi: 1 },
      ],
      home_lineup: [{ player_id: "p3", ab: 4, h: 1 }],
      away_pitchers: [{ player_id: "p4", ip_outs: 21, so: 8, er: 2 }],
      home_pitchers: [{ player_id: "p5", ip_outs: 18, so: 4, er: 6 }],
      linescore: {
        away: [0, 1, 0, 0, 2, 0, 3, 0, 1],
        home: [1, 0, 1, 0, 0, 0, 2, 1, 0],
      },
      hits: { away: 8, home: 6 },
      errors: { away: 1, home: 2 },
      away_score: 7,
      home_score: 5,
    });
    mockState.collections.set("leagues/sfbl/teams", [
      {
        id: "team_a",
        data: {
          name: "Yankees",
          abbrev: "NYY",
          color: "#003087",
          logo_url: "/logos/sfbl/nyy.png",
        },
      },
      {
        id: "team_b",
        data: {
          name: "Red Sox",
          abbrev: "BOS",
          color: "#bd3039",
        },
      },
    ]);
    mockState.collections.set("leagues/sfbl/players", [
      { id: "p1", data: { name: "Aaron Judge", team_id: "team_a" } },
      { id: "p2", data: { name: "Juan Soto", team_id: "team_a" } },
      { id: "p3", data: { name: "Mookie Betts", team_id: "team_b" } },
      { id: "p4", data: { name: "Gerrit Cole", team_id: "team_a" } },
      { id: "p5", data: { name: "Chris Sale", team_id: "team_b" } },
    ]);
    mockState.collections.set("leagues/sfbl/games", [
      // Just g1 itself for the standings calc.
      { id: "g1", data: mockState.docs.get("leagues/sfbl/games/g1")! },
    ]);
  });

  it("returns the canonical BoxScoreContentProps shape", async () => {
    const data = await loadBoxScoreData("sfbl", "g1", 9);
    expect(data).not.toBeNull();
    expect(data!.gameId).toBe("g1");
    expect(data!.date).toBe("2026-05-10T18:00:00");
    expect(data!.field).toBe("Field 1");
    expect(data!.status).toBe("final");
    expect(data!.innings).toBe(9);
  });

  it("populates away + home team blocks with metadata + scores", async () => {
    const data = await loadBoxScoreData("sfbl", "g1", 9);
    expect(data!.away.team_id).toBe("team_a");
    expect(data!.away.name).toBe("Yankees");
    expect(data!.away.abbrev).toBe("NYY");
    expect(data!.away.color).toBe("#003087");
    expect(data!.away.logoUrl).toBe("/logos/sfbl/nyy.png");
    expect(data!.away.score).toBe(7);
    expect(data!.home.team_id).toBe("team_b");
    expect(data!.home.name).toBe("Red Sox");
    expect(data!.home.score).toBe(5);
  });

  it("attaches per-team season record (from standings calc)", async () => {
    const data = await loadBoxScoreData("sfbl", "g1", 9);
    // After 1 final game with team_a winning, team_a is 1-0.
    expect(data!.away.record).toBe("1-0");
    expect(data!.home.record).toBe("0-1");
  });

  it("threads through lineups, pitchers, linescore, hits, errors", async () => {
    const data = await loadBoxScoreData("sfbl", "g1", 9);
    expect(data!.away.lineup).toHaveLength(2);
    expect(data!.away.lineup[0]!.player_id).toBe("p1");
    expect(data!.away.pitchers).toHaveLength(1);
    expect(data!.away.linescore).toEqual([0, 1, 0, 0, 2, 0, 3, 0, 1]);
    expect(data!.away.hits).toBe(8);
    expect(data!.away.errors).toBe(1);
  });

  it("includes a player-name lookup for the recap renderer", async () => {
    const data = await loadBoxScoreData("sfbl", "g1", 9);
    expect(data!.playerNames["p1"]).toBe("Aaron Judge");
    expect(data!.playerNames["p3"]).toBe("Mookie Betts");
    expect(data!.playerNames["p5"]).toBe("Chris Sale");
  });
});

// ── mid-flow: game exists, box score doc doesn't ─────────────────

describe("loadBoxScoreData — game exists but no box_score yet", () => {
  it("renders with empty lineups + missing linescore (no crash)", async () => {
    // After the game is created but before either captain submits.
    mockState.docs.set("leagues/sfbl/games/g1", {
      home_team_id: "team_b",
      away_team_id: "team_a",
      status: "scheduled",
      date: "2026-05-10",
    });
    // No /box_scores/g1 doc.
    mockState.collections.set("leagues/sfbl/teams", [
      { id: "team_a", data: { name: "Yankees" } },
      { id: "team_b", data: { name: "Red Sox" } },
    ]);
    mockState.collections.set("leagues/sfbl/games", [
      { id: "g1", data: mockState.docs.get("leagues/sfbl/games/g1")! },
    ]);
    mockState.collections.set("leagues/sfbl/players", []);

    const data = await loadBoxScoreData("sfbl", "g1", 9);
    expect(data).not.toBeNull();
    expect(data!.status).toBe("scheduled");
    expect(data!.away.lineup).toEqual([]);
    expect(data!.home.lineup).toEqual([]);
    expect(data!.away.pitchers).toEqual([]);
    expect(data!.home.pitchers).toEqual([]);
    // No linescore → undefined (UI handles)
    expect(data!.away.linescore).toBeUndefined();
    expect(data!.home.linescore).toBeUndefined();
    // Missing scores default to 0.
    expect(data!.away.score).toBe(0);
    expect(data!.home.score).toBe(0);
  });
});

// ── score-only mode ───────────────────────────────────────────────

describe("loadBoxScoreData — score-only flag passthrough", () => {
  it("away_score_only flag propagates to away.score_only", async () => {
    mockState.docs.set("leagues/sfbl/games/g1", {
      home_team_id: "team_b",
      away_team_id: "team_a",
      home_score: 5,
      away_score: 7,
      status: "final",
    });
    mockState.docs.set("leagues/sfbl/box_scores/g1", {
      away_score: 7,
      home_score: 5,
      away_score_only: true,
      home_score_only: false,
      home_lineup: [{ player_id: "p3", ab: 3, h: 1 }],
    });
    mockState.collections.set("leagues/sfbl/teams", [
      { id: "team_a", data: { name: "A" } },
      { id: "team_b", data: { name: "B" } },
    ]);
    mockState.collections.set("leagues/sfbl/games", [
      { id: "g1", data: mockState.docs.get("leagues/sfbl/games/g1")! },
    ]);
    mockState.collections.set("leagues/sfbl/players", []);

    const data = await loadBoxScoreData("sfbl", "g1", 9);
    expect(data!.away.score_only).toBe(true);
    expect(data!.home.score_only).toBe(false);
  });
});

// ── data hygiene: orphan lineup rows ─────────────────────────────

describe("loadBoxScoreData — defensive filtering", () => {
  it("filters lineup entries with no player_id (orphan/template rows)", async () => {
    mockState.docs.set("leagues/sfbl/games/g1", {
      home_team_id: "team_b",
      away_team_id: "team_a",
      status: "final",
      home_score: 1,
      away_score: 2,
    });
    mockState.docs.set("leagues/sfbl/box_scores/g1", {
      away_lineup: [
        { player_id: "p1", ab: 4, h: 2 },
        { player_id: "", ab: 0, h: 0 }, // orphan — drop
        { ab: 3, h: 1 }, // missing player_id entirely — drop
        { player_id: "p2", ab: 3, h: 1 },
      ],
      home_lineup: [],
      away_pitchers: [
        { player_id: "p3", ip_outs: 21 },
        { player_id: "" }, // orphan
      ],
    });
    mockState.collections.set("leagues/sfbl/teams", [
      { id: "team_a", data: { name: "A" } },
      { id: "team_b", data: { name: "B" } },
    ]);
    mockState.collections.set("leagues/sfbl/games", [
      { id: "g1", data: mockState.docs.get("leagues/sfbl/games/g1")! },
    ]);
    mockState.collections.set("leagues/sfbl/players", []);

    const data = await loadBoxScoreData("sfbl", "g1", 9);
    // Two valid batters survive.
    expect(data!.away.lineup).toHaveLength(2);
    expect(data!.away.lineup.map((b) => b.player_id)).toEqual(["p1", "p2"]);
    expect(data!.away.pitchers).toHaveLength(1);
    expect(data!.away.pitchers[0]!.player_id).toBe("p3");
  });

  it("falls back to team_id as name when team metadata missing", async () => {
    mockState.docs.set("leagues/sfbl/games/g1", {
      home_team_id: "ghost_team",
      away_team_id: "phantom_team",
      status: "scheduled",
    });
    // No team docs.
    mockState.collections.set("leagues/sfbl/teams", []);
    mockState.collections.set("leagues/sfbl/games", [
      { id: "g1", data: mockState.docs.get("leagues/sfbl/games/g1")! },
    ]);
    mockState.collections.set("leagues/sfbl/players", []);

    const data = await loadBoxScoreData("sfbl", "g1", 9);
    expect(data!.away.name).toBe("phantom_team");
    expect(data!.home.name).toBe("ghost_team");
  });

  it("missing date / field / status default cleanly (no 'undefined' leaks)", async () => {
    mockState.docs.set("leagues/sfbl/games/g1", {
      home_team_id: "a",
      away_team_id: "b",
    });
    mockState.collections.set("leagues/sfbl/teams", []);
    mockState.collections.set("leagues/sfbl/games", [
      { id: "g1", data: mockState.docs.get("leagues/sfbl/games/g1")! },
    ]);
    mockState.collections.set("leagues/sfbl/players", []);

    const data = await loadBoxScoreData("sfbl", "g1", 9);
    expect(data!.date).toBeNull();
    expect(data!.field).toBeNull();
    expect(data!.status).toBe("draft"); // route default
  });
});

// ── multi-game season → record correctness ────────────────────────

describe("loadBoxScoreData — record reflects full season", () => {
  it("records show team_a 2-1 across three games (not just this one)", async () => {
    mockState.docs.set("leagues/sfbl/games/g3", {
      home_team_id: "team_b",
      away_team_id: "team_a",
      status: "final",
      home_score: 4,
      away_score: 1, // team_a loses this one
    });
    mockState.collections.set("leagues/sfbl/games", [
      // Earlier games:
      {
        id: "g1",
        data: {
          home_team_id: "team_a",
          away_team_id: "team_b",
          status: "final",
          home_score: 5,
          away_score: 3,
        },
      },
      {
        id: "g2",
        data: {
          home_team_id: "team_b",
          away_team_id: "team_a",
          status: "final",
          home_score: 2,
          away_score: 7,
        },
      },
      // Current game:
      { id: "g3", data: mockState.docs.get("leagues/sfbl/games/g3")! },
    ]);
    mockState.collections.set("leagues/sfbl/teams", [
      { id: "team_a", data: { name: "A" } },
      { id: "team_b", data: { name: "B" } },
    ]);
    mockState.collections.set("leagues/sfbl/players", []);

    const data = await loadBoxScoreData("sfbl", "g3", 9);
    // Across all 3 finals: team_a won g1 + g2, lost g3 → 2-1.
    expect(data!.away.record).toBe("2-1"); // team_a
    expect(data!.home.record).toBe("1-2"); // team_b
  });
});
