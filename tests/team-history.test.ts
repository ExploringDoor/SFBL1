import { describe, it, expect } from "vitest";
import {
  buildTeamHistory,
  buildTeamGameLog,
  type ArchiveBlock,
  type ArchivedGame,
  type ChampionsFile,
} from "../lib/team-history";

const archive: ArchiveBlock[] = [
  {
    season: "2025",
    game_type: "season",
    division: "10u Section 1",
    standings: [
      { team: "Hempfield Black", w: 12, l: 4, t: 0 },
      { team: "LS Blue", w: 10, l: 6, t: 0 },
    ],
  },
  {
    season: "2024",
    game_type: "season",
    division: "10u Section 1",
    standings: [
      { team: "LS Blue", w: 14, l: 2, t: 0 },
      { team: "HEMPFIELD BLACK", w: 9, l: 6, t: 1 },
    ],
  },
];

const champions: ChampionsFile[] = [
  {
    season: "2025",
    divisions: [
      { division: "10u Section 1", team: "HEMPFIELD BLACK", runner_up: "LS BLUE" },
    ],
  },
  {
    season: "2024",
    divisions: [
      { division: "10u Section 1", team: "LS Blue", runner_up: "Hempfield Black" },
    ],
  },
];

describe("buildTeamHistory", () => {
  it("collects every season the team appears in, newest first", () => {
    const h = buildTeamHistory("Hempfield Black", archive, champions);
    expect(h.seasons.map((s) => s.season)).toEqual(["2025", "2024"]);
  });

  it("matches case-insensitively across differently-spelled archives", () => {
    // 2024 spells it ALL CAPS (transcribed from a banner); a case-sensitive
    // match would drop half this franchise's history.
    const h = buildTeamHistory("Hempfield Black", archive, champions);
    expect(h.seasons).toHaveLength(2);
    expect(h.titles).toHaveLength(1);
    expect(h.runnerUps).toHaveLength(1);
  });

  it("totals the record across seasons", () => {
    const h = buildTeamHistory("Hempfield Black", archive, champions);
    expect(h.totals).toMatchObject({ w: 21, l: 10, t: 1, seasons: 2 });
    expect(h.totals.pct).toBe(".672");
  });

  it("records finishing position within the division", () => {
    const h = buildTeamHistory("Hempfield Black", archive, champions);
    expect(h.seasons[0]).toMatchObject({ place: 1, outOf: 2, champion: true });
    expect(h.seasons[1]).toMatchObject({ place: 2, outOf: 2, runnerUp: true });
  });

  it("finds titles that champions.json states even with no playoff block", () => {
    // The whole reason this module exists: the old counter required a
    // game_type:"playoff" block, and LCYBL has none.
    const h = buildTeamHistory("LS Blue", archive, champions);
    expect(h.titles).toEqual([
      { season: "2024", division: "10u Section 1", disputed: false },
    ]);
  });

  it("carries a disputed title through rather than hiding it", () => {
    const h = buildTeamHistory("Foo", [], [
      { season: "2025", divisions: [{ division: "12u", team: "Foo", disputed: true }] },
    ]);
    expect(h.titles[0]).toMatchObject({ disputed: true });
  });

  it("returns empty history for a team not in the archive", () => {
    const h = buildTeamHistory("Brand New Club", archive, champions);
    expect(h.seasons).toEqual([]);
    expect(h.titles).toEqual([]);
    expect(h.totals).toMatchObject({ w: 0, l: 0, seasons: 0 });
  });

  it("ignores playoff blocks so a bracket does not double-count a record", () => {
    const withPlayoff: ArchiveBlock[] = [
      ...archive,
      {
        season: "2025",
        game_type: "playoff",
        division: "10u Section 1",
        standings: [{ team: "Hempfield Black", w: 3, l: 0, t: 0 }],
      },
    ];
    const h = buildTeamHistory("Hempfield Black", withPlayoff, champions);
    expect(h.totals.w).toBe(21);
  });

  it("survives a malformed archive instead of throwing", () => {
    const junk = [null, { season: "x" }, { standings: null }] as unknown as ArchiveBlock[];
    expect(() => buildTeamHistory("Foo", junk, [])).not.toThrow();
  });
});

describe("buildTeamGameLog", () => {
  const games: Record<string, ArchivedGame[]> = {
    "2024": [
      // Team listed first ("away" slot is reading order, not real away).
      {
        division: "10u Section 1",
        away: "HEMPFIELD BLACK",
        home: "Warwick Braves",
        away_score: 7,
        home_score: 3,
        orientation_known: false,
      },
      // Team listed second, loses.
      {
        division: "10u Section 1",
        away: "Manheim Lions",
        home: "Hempfield Black",
        away_score: 5,
        home_score: 2,
        orientation_known: false,
      },
      // No printed score: a matchup, not a result — must be skipped.
      {
        division: "10u Section 1",
        away: "Hempfield Black",
        home: "PM Comets",
        away_score: null,
        home_score: null,
      },
      // Some other pairing entirely.
      {
        division: "12u Section 2",
        away: "LS Blue",
        home: "Cedar Crest",
        away_score: 1,
        home_score: 0,
      },
    ],
    "2023": [
      {
        division: "10u Section 1",
        away: "E-Town Gray",
        home: "hempfield black",
        away_score: 4,
        home_score: 4,
      },
    ],
  };

  it("matches case-insensitively on both sides and orients the score to the team", () => {
    const log = buildTeamGameLog("Hempfield Black", games);
    const y24 = log.get("2024")!;
    expect(y24).toHaveLength(2);
    expect(y24[0]).toMatchObject({
      opponent: "Warwick Braves",
      scored: 7,
      allowed: 3,
      result: "W",
    });
    expect(y24[1]).toMatchObject({
      opponent: "Manheim Lions",
      scored: 2,
      allowed: 5,
      result: "L",
    });
  });

  it("records ties and keys seasons newest-first", () => {
    const log = buildTeamGameLog("Hempfield Black", games);
    expect([...log.keys()]).toEqual(["2024", "2023"]);
    expect(log.get("2023")![0]).toMatchObject({ result: "T", scored: 4 });
  });

  it("returns an empty map for a team with no archived games", () => {
    expect(buildTeamGameLog("Brand New Club", games).size).toBe(0);
  });
});
