import { describe, expect, it } from "vitest";
import { buildWithGameslate, type GameslateBuild } from "@/lib/gameslate/adapter";
import {
  DEFAULT_GAMESLATE_RULES,
  linkedGroups,
  normaliseGameslateRules,
  type GameslateRules,
} from "@/lib/gameslate/rules";

// The adapter is the seam between the Build Schedule screen and the GameSlate
// engine. These pin the two things the screen relies on: the rules it saves
// come back in bounds whatever was stored, and the result it renders has the
// platform's shape however the games were built.

function teams(n: number, extra: (i: number) => Record<string, unknown> = () => ({})) {
  return Array.from({ length: n }, (_, i) => ({
    id: `t${i + 1}`,
    name: `Team ${i + 1}`,
    ...extra(i),
  }));
}

const gyms = [
  { name: "Gym A", times: ["09:00", "10:15"] },
  { name: "Gym B", times: ["09:00", "10:15"] },
];

function build(over: Partial<GameslateBuild> = {}, rules: Partial<GameslateRules> = {}) {
  return buildWithGameslate({
    teams: teams(4),
    startDate: "2026-11-07",
    endDate: "2027-02-27",
    daysOfWeek: [6],
    blackoutDates: [],
    fields: gyms,
    blockedPairs: [],
    division: "3rd Grade Boys",
    gamesPerWeek: 1,
    gamesPerTeam: 0,
    weeklyPairing: "different-opponents",
    existingGames: [],
    seed: 1,
    ...over,
    rules: { ...DEFAULT_GAMESLATE_RULES, ...rules },
  });
}

describe("normaliseGameslateRules", () => {
  it("nothing in, the defaults out", () => {
    expect(normaliseGameslateRules(undefined)).toEqual(DEFAULT_GAMESLATE_RULES);
    expect(normaliseGameslateRules(null)).toEqual(DEFAULT_GAMESLATE_RULES);
    expect(normaliseGameslateRules("junk")).toEqual(DEFAULT_GAMESLATE_RULES);
  });

  it("clamps every number and falls back on every choice", () => {
    const r = normaliseGameslateRules({
      cycles: 7,
      gameMinutes: 999,
      maxPerTeamPerDay: "2",
      doubleheaders: "sometimes",
      minGapMinutes: -5,
      maxGapMinutes: 10000,
      minDaysRest: 3.9,
      slotPreference: "random",
      homeFieldRule: "never",
      noRematchWeeks: 99,
      maxConsecutive: -1,
      pairAlternate: "yes",
    });
    expect(r).toEqual({
      ...DEFAULT_GAMESLATE_RULES,
      cycles: 3,
      gameMinutes: 300,
      maxPerTeamPerDay: 2,
      minGapMinutes: 0,
      maxGapMinutes: 480,
      minDaysRest: 3,
      noRematchWeeks: 8,
      maxConsecutive: 0,
      pairAlternate: false,
    });
  });

  it("keeps only clean, unique, two-team linked pairs", () => {
    const r = normaliseGameslateRules({
      linkedPairs: [
        ["a", "b"],
        ["b", "a"], // same pair, other order
        ["a", "a"], // self
        ["a"], // not a pair
        ["ok", "bad id!"],
        ["c", "d"],
        "nope",
      ],
    });
    expect(r.linkedPairs).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("drops keys it does not know, so a stored document cannot smuggle options in", () => {
    const r = normaliseGameslateRules({ maxMilesFromHome: 5, seed: 9, cycles: 1 });
    expect(Object.keys(r).sort()).toEqual(Object.keys(DEFAULT_GAMESLATE_RULES).sort());
    expect(r.cycles).toBe(1);
  });
});

describe("linkedGroups", () => {
  it("joins overlapping pairs into one group", () => {
    expect(
      linkedGroups([
        ["a", "b"],
        ["b", "c"],
        ["x", "y"],
      ]),
    ).toEqual([
      ["a", "b", "c"],
      ["x", "y"],
    ]);
  });
  it("is empty for no pairs", () => {
    expect(linkedGroups([])).toEqual([]);
  });
});

describe("buildWithGameslate", () => {
  it("returns the platform's result shape, graded, with exactly the game fields the API accepts", () => {
    const r = build({}, { cycles: 1 });
    expect(r.engine).toBe("gameslate");
    expect(r.seed).toBe(1);
    expect(r.games).toHaveLength(6); // 4 teams, everyone once
    expect(r.everyPairPlayed).toBe(true);
    expect(r.unscheduled).toEqual([]);
    expect(r.quality.grade).toMatch(/^[A-F]$/);
    expect(r.quality.score).toBeGreaterThan(0);
    // The screen renders these; the platform engine fills them the same way.
    expect(r.gamesPerTeamActual).toEqual([
      { team: "Team 1", games: 3 },
      { team: "Team 2", games: 3 },
      { team: "Team 3", games: 3 },
      { team: "Team 4", games: 3 },
    ]);
    expect(r.extraGameTeams).toEqual([]);
    expect(r.sameOrgUsed).toEqual([]);
    expect(r.repeatMatchups).toEqual([]);
    for (const g of r.games) {
      expect(Object.keys(g).sort()).toEqual(
        ["away_team_id", "date", "division", "field", "home_team_id", "status", "time", "week"],
      );
      expect(g.status).toBe("scheduled");
      expect(g.division).toBe("3rd Grade Boys");
    }
  });

  it("same seed, same schedule; the seed is what 'Try another layout' changes", () => {
    const a = build({ seed: 5 }, { cycles: 1 });
    const b = build({ seed: 5 }, { cycles: 1 });
    expect(a.games).toEqual(b.games);
  });

  it("a games-per-team target beats the season shape", () => {
    const r = build({ teams: teams(6), gamesPerTeam: 2 }, { cycles: 3 });
    expect(r.gamesPerTeamActual.every((t) => t.games === 2)).toBe(true);
    expect(r.games).toHaveLength(6);
  });

  it("fill mode does not call repeats a problem; a single round robin would", () => {
    // Long calendar, four teams: fill mode cycles the matchups again.
    const fill = build({}, { cycles: 0 });
    expect(fill.games.length).toBeGreaterThan(6);
    expect(fill.repeatMatchups).toEqual([]);
    const once = build({}, { cycles: 1 });
    expect(once.repeatMatchups).toEqual([]);
  });

  it("works around games another division already put on the calendar", () => {
    const taken = {
      id: "x",
      date: "2026-11-07",
      time: "09:00",
      field: "Gym A",
      away_team_id: "z1",
      home_team_id: "z2",
    };
    const r = build({ existingGames: [taken] }, { cycles: 1 });
    const clash = r.games.find(
      (g) => g.date === "2026-11-07" && g.time === "09:00" && g.field === "Gym A",
    );
    expect(clash).toBeUndefined();
    expect(r.slotsBlockedByExisting).toBeGreaterThan(0);
  });

  it("lists a game where both teams have a home gym, so the admin can pick the host", () => {
    const r = build(
      {
        teams: [
          { id: "t1", name: "Mineola", homeField: "Gym A" },
          { id: "t2", name: "Quitman", homeField: "Gym B" },
        ],
      },
      { cycles: 1 },
    );
    expect(r.games).toHaveLength(1);
    expect(r.homeFieldChoices).toHaveLength(1);
    const c = r.homeFieldChoices[0]!;
    expect(c.game).toBe(0);
    expect([c.aField, c.bField].sort()).toEqual(["Gym A", "Gym B"]);
    expect(c.chosen).toBe(r.games[0]!.field);
    expect([c.aName, c.bName].sort()).toEqual(["Mineola", "Quitman"]);
  });

  it("linked teams are never on the floor at the same time", () => {
    const r = build({ teams: teams(6) }, { cycles: 1, linkedPairs: [["t1", "t3"]] });
    const plays = (g: (typeof r.games)[number], id: string) =>
      g.home_team_id === id || g.away_team_id === id;
    // Their head-to-head game is one game, not the coach in two gyms.
    const when = (id: string, other: string) =>
      r.games
        .filter((g) => plays(g, id) && !plays(g, other))
        .map((g) => `${g.date} ${g.time}`);
    const t1 = new Set(when("t1", "t3"));
    for (const slot of when("t3", "t1")) expect(t1.has(slot)).toBe(false);
    expect(r.games.some((g) => plays(g, "t1") && plays(g, "t3"))).toBe(true);
    expect(r.everyPairPlayed).toBe(true);
  });

  it("one game a day means one game a day", () => {
    const r = build(
      { teams: teams(6), gamesPerWeek: 2 },
      { cycles: 1, maxPerTeamPerDay: 1, gameMinutes: 75 },
    );
    const perDay = new Map<string, number>();
    for (const g of r.games) {
      for (const id of [g.home_team_id, g.away_team_id]) {
        const k = `${id}|${g.date}`;
        perDay.set(k, (perDay.get(k) ?? 0) + 1);
      }
    }
    expect(Math.max(...perDay.values())).toBe(1);
  });
});
