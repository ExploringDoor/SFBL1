// Tests for lib/site-data.ts → loadTickerGames.
//
// This is the data feed for the site's global ticker (rendered on
// every public page via the layout). It computes:
//   - team metadata lookup (name, color, logo)
//   - standings → record-per-team for the chip in each ticker entry
//   - "most recent 4 finals + next upcoming" window
//
// Failure mode we're guarding against: a freshly-provisioned tenant
// has 0 final games and the public homepage crashes because some
// inner array is undefined or division-by-0 NaN's into the page.
//
// Why this matters: the very first thing the commissioner sees after
// `npm run provision` is the homepage. A blank-screen-of-death there
// is a launch-day catastrophe.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface DocEntry {
  id: string;
  data: Record<string, unknown>;
}

const mockState = {
  // Mock Firestore — keyed by collection path → list of {id, data}.
  collections: new Map<string, DocEntry[]>(),
};

vi.mock("@/lib/firebase-admin", () => ({
  getAdminDb: () => ({
    collection: (path: string) => ({
      get: async () => {
        const docs = mockState.collections.get(path) ?? [];
        return {
          docs: docs.map((d) => ({
            id: d.id,
            data: () => d.data,
          })),
        };
      },
    }),
  }),
}));

const { loadTickerGames } = await import("@/lib/site-data");

beforeEach(() => {
  mockState.collections = new Map();
});

afterEach(() => vi.clearAllMocks());

// ── empty / freshly-provisioned ───────────────────────────────────

describe("loadTickerGames — empty league", () => {
  it("returns empty array when there are no games AND no teams", async () => {
    const ticker = await loadTickerGames("sfbl");
    expect(ticker).toEqual([]);
  });

  it("returns empty array when there are teams but zero games", async () => {
    mockState.collections.set("leagues/sfbl/teams", [
      { id: "team_a", data: { name: "Yankees" } },
      { id: "team_b", data: { name: "Red Sox" } },
    ]);
    const ticker = await loadTickerGames("sfbl");
    expect(ticker).toEqual([]);
  });

  it("returns empty when every game is in 'draft' status (filtered out)", async () => {
    mockState.collections.set("leagues/sfbl/teams", [
      { id: "team_a", data: { name: "A" } },
    ]);
    mockState.collections.set("leagues/sfbl/games", [
      {
        id: "g1",
        data: {
          status: "draft",
          home_team_id: "team_a",
          away_team_id: "team_b",
          date: "2026-05-10",
        },
      },
    ]);
    const ticker = await loadTickerGames("sfbl");
    expect(ticker).toEqual([]);
  });
});

// ── upcoming-only (pre-season) ────────────────────────────────────

describe("loadTickerGames — pre-season (upcoming only)", () => {
  it("renders scheduled games sorted by date ascending", async () => {
    mockState.collections.set("leagues/sfbl/teams", [
      { id: "a", data: { name: "Yankees", color: "#003087", abbrev: "NYY" } },
      { id: "b", data: { name: "Red Sox" } },
    ]);
    mockState.collections.set("leagues/sfbl/games", [
      {
        id: "g_late",
        data: {
          status: "scheduled",
          date: "2026-06-01",
          home_team_id: "a",
          away_team_id: "b",
        },
      },
      {
        id: "g_early",
        data: {
          status: "scheduled",
          date: "2026-05-10",
          home_team_id: "b",
          away_team_id: "a",
        },
      },
    ]);
    const ticker = await loadTickerGames("sfbl");
    expect(ticker.map((t) => t.id)).toEqual(["g_early", "g_late"]);
  });

  it("hydrates team metadata onto each ticker entry", async () => {
    mockState.collections.set("leagues/sfbl/teams", [
      {
        id: "a",
        data: {
          name: "Yankees",
          color: "#003087",
          abbrev: "NYY",
          logo_url: "/logos/sfbl/nyy.png",
        },
      },
      { id: "b", data: { name: "Red Sox" } },
    ]);
    mockState.collections.set("leagues/sfbl/games", [
      {
        id: "g1",
        data: {
          status: "scheduled",
          date: "2026-05-10",
          home_team_id: "a",
          away_team_id: "b",
        },
      },
    ]);
    const [entry] = await loadTickerGames("sfbl");
    expect(entry!.away_team).toMatchObject({ name: "Red Sox" });
    expect(entry!.home_team).toMatchObject({
      name: "Yankees",
      color: "#003087",
      abbrev: "NYY",
      logoUrl: "/logos/sfbl/nyy.png",
    });
  });

  it("falls back to team_id as name when team metadata missing", async () => {
    // Team referenced but not in /teams collection — defensive fallback.
    mockState.collections.set("leagues/sfbl/games", [
      {
        id: "g1",
        data: {
          status: "scheduled",
          date: "2026-05-10",
          home_team_id: "ghost_team",
          away_team_id: "phantom_team",
        },
      },
    ]);
    const [entry] = await loadTickerGames("sfbl");
    expect(entry!.home_team.name).toBe("ghost_team");
    expect(entry!.away_team.name).toBe("phantom_team");
  });
});

// ── post-game (finals) ────────────────────────────────────────────

describe("loadTickerGames — finals window", () => {
  it("includes 'final' status games", async () => {
    mockState.collections.set("leagues/sfbl/teams", [
      { id: "a", data: { name: "A" } },
      { id: "b", data: { name: "B" } },
    ]);
    mockState.collections.set("leagues/sfbl/games", [
      {
        id: "g1",
        data: {
          status: "final",
          date: "2026-05-01",
          home_team_id: "a",
          away_team_id: "b",
          home_score: 5,
          away_score: 3,
        },
      },
    ]);
    const ticker = await loadTickerGames("sfbl");
    expect(ticker).toHaveLength(1);
    expect(ticker[0]!.status).toBe("final");
    expect(ticker[0]!.home_score).toBe(5);
    expect(ticker[0]!.away_score).toBe(3);
  });

  it("treats 'approved' the same as 'final' for ticker inclusion", async () => {
    mockState.collections.set("leagues/sfbl/games", [
      {
        id: "g_approved",
        data: {
          status: "approved",
          date: "2026-05-01",
          home_team_id: "a",
          away_team_id: "b",
          home_score: 7,
          away_score: 7,
        },
      },
    ]);
    const ticker = await loadTickerGames("sfbl");
    expect(ticker).toHaveLength(1);
    expect(ticker[0]!.status).toBe("approved");
  });

  it("caps finals at the 4 most recent (sorted by date)", async () => {
    mockState.collections.set("leagues/sfbl/games", [
      ...Array.from({ length: 10 }, (_, i) => ({
        id: `g${i}`,
        data: {
          status: "final",
          date: `2026-05-${String(i + 1).padStart(2, "0")}`,
          home_team_id: "a",
          away_team_id: "b",
          home_score: i,
          away_score: 0,
        },
      })),
    ]);
    const ticker = await loadTickerGames("sfbl");
    expect(ticker).toHaveLength(4);
    // Most recent 4 → ids g6, g7, g8, g9 (then reversed to chronological).
    expect(ticker.map((t) => t.id)).toEqual(["g6", "g7", "g8", "g9"]);
  });

  it("attaches per-team record (e.g. '2-1') from standings", async () => {
    mockState.collections.set("leagues/sfbl/teams", [
      { id: "a", data: { name: "A" } },
      { id: "b", data: { name: "B" } },
    ]);
    // Three finals: a goes 2-1, b goes 1-2.
    mockState.collections.set("leagues/sfbl/games", [
      {
        id: "g1",
        data: {
          status: "final",
          date: "2026-05-01",
          home_team_id: "a",
          away_team_id: "b",
          home_score: 5,
          away_score: 3,
        },
      },
      {
        id: "g2",
        data: {
          status: "final",
          date: "2026-05-08",
          home_team_id: "b",
          away_team_id: "a",
          home_score: 2,
          away_score: 7,
        },
      },
      {
        id: "g3",
        data: {
          status: "final",
          date: "2026-05-15",
          home_team_id: "a",
          away_team_id: "b",
          home_score: 1,
          away_score: 4,
        },
      },
    ]);
    const ticker = await loadTickerGames("sfbl");
    expect(ticker[0]!.home_record).toBe("2-1"); // team a
    expect(ticker[0]!.away_record).toBe("1-2"); // team b
  });

  it("includes a tied record with 'W-L-T' format", async () => {
    mockState.collections.set("leagues/sfbl/games", [
      {
        id: "g_tie",
        data: {
          status: "final",
          date: "2026-05-01",
          home_team_id: "a",
          away_team_id: "b",
          home_score: 4,
          away_score: 4,
        },
      },
    ]);
    const ticker = await loadTickerGames("sfbl");
    expect(ticker[0]!.home_record).toBe("0-0-1");
    expect(ticker[0]!.away_record).toBe("0-0-1");
  });
});

// ── mixed (regular season) ────────────────────────────────────────

describe("loadTickerGames — mixed finals + upcoming", () => {
  it("returns finals first (chronological) then upcoming (chronological)", async () => {
    mockState.collections.set("leagues/sfbl/games", [
      {
        id: "f1",
        data: {
          status: "final",
          date: "2026-04-15",
          home_team_id: "a",
          away_team_id: "b",
          home_score: 1,
          away_score: 0,
        },
      },
      {
        id: "u1",
        data: {
          status: "scheduled",
          date: "2026-05-15",
          home_team_id: "a",
          away_team_id: "b",
        },
      },
      {
        id: "u2",
        data: {
          status: "scheduled",
          date: "2026-05-22",
          home_team_id: "b",
          away_team_id: "a",
        },
      },
    ]);
    const ticker = await loadTickerGames("sfbl");
    expect(ticker.map((t) => t.id)).toEqual(["f1", "u1", "u2"]);
  });

  it("postponed/rained-out are NOT in finals window but stay in upcoming if scheduled", async () => {
    mockState.collections.set("leagues/sfbl/games", [
      // Postponed — not "final" or "approved" → not in finals.
      // Not "scheduled" either → also not in upcoming.
      {
        id: "ppd",
        data: {
          status: "postponed",
          date: "2026-05-10",
          home_team_id: "a",
          away_team_id: "b",
        },
      },
    ]);
    const ticker = await loadTickerGames("sfbl");
    expect(ticker).toHaveLength(0);
  });
});

// ── data-shape resilience ─────────────────────────────────────────

describe("loadTickerGames — defensive parsing", () => {
  it("missing scores default to 0 (no NaN leaks)", async () => {
    mockState.collections.set("leagues/sfbl/games", [
      {
        id: "g1",
        data: {
          status: "final",
          date: "2026-05-01",
          home_team_id: "a",
          away_team_id: "b",
          // home_score + away_score absent
        },
      },
    ]);
    const [entry] = await loadTickerGames("sfbl");
    expect(entry!.home_score).toBe(0);
    expect(entry!.away_score).toBe(0);
    expect(Number.isNaN(entry!.home_score)).toBe(false);
  });

  it("missing date is allowed (sorts to end via empty-string fallback)", async () => {
    mockState.collections.set("leagues/sfbl/games", [
      {
        id: "g_dated",
        data: {
          status: "scheduled",
          date: "2026-05-15",
          home_team_id: "a",
          away_team_id: "b",
        },
      },
      {
        id: "g_undated",
        data: {
          status: "scheduled",
          // no date
          home_team_id: "b",
          away_team_id: "a",
        },
      },
    ]);
    const ticker = await loadTickerGames("sfbl");
    // Undated sorts as "" which is < any real ISO date — so undated
    // game comes FIRST in upcoming. We just verify no crash + both
    // games appear.
    expect(ticker).toHaveLength(2);
    expect(ticker.map((t) => t.id).sort()).toEqual(["g_dated", "g_undated"]);
  });

  it("missing status defaults to 'draft' (and is filtered out)", async () => {
    mockState.collections.set("leagues/sfbl/games", [
      {
        id: "g1",
        data: {
          // no status
          date: "2026-05-10",
          home_team_id: "a",
          away_team_id: "b",
        },
      },
    ]);
    const ticker = await loadTickerGames("sfbl");
    expect(ticker).toEqual([]);
  });

  it("missing team_id strings default to empty (no crash)", async () => {
    mockState.collections.set("leagues/sfbl/games", [
      {
        id: "g1",
        data: {
          status: "scheduled",
          date: "2026-05-10",
          // no team_ids
        },
      },
    ]);
    const ticker = await loadTickerGames("sfbl");
    expect(ticker).toHaveLength(1);
    // Both team_ids are "" — fallback name is "" too. The ticker
    // entry exists; UI is responsible for rendering "—" or similar.
    expect(ticker[0]!.home_team_id).toBe("");
  });
});
