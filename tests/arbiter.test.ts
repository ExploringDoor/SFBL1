import { describe, it, expect } from "vitest";
import {
  parseArbiterDate,
  parseArbiterTime,
  parseScore,
  parseArbiterSchedule,
  matchTeamNames,
  toArbiterCsv,
  toDisplayDate,
  toDisplayTime,
  arbiterGameId,
  type MatchableTeam,
} from "../lib/arbiter";

describe("parseArbiterDate", () => {
  it("reads the format LCYBL's own exports use", () => {
    // Their schedule PDFs open with rows like "13-Apr-26 Mon 372 6:00PM ...".
    expect(parseArbiterDate("13-Apr-26")).toBe("2026-04-13");
    expect(parseArbiterDate("1-Sep-25")).toBe("2025-09-01");
  });

  it("reads the other shapes these exports come in", () => {
    expect(parseArbiterDate("2026-04-13")).toBe("2026-04-13");
    expect(parseArbiterDate("4/13/2026")).toBe("2026-04-13");
    expect(parseArbiterDate("04/13/26")).toBe("2026-04-13");
    expect(parseArbiterDate("Apr 13, 2026")).toBe("2026-04-13");
    expect(parseArbiterDate("April 13 2026")).toBe("2026-04-13");
    expect(parseArbiterDate("13 Apr 2026")).toBe("2026-04-13");
  });

  it("does not shift a two-digit year into the wrong century", () => {
    expect(parseArbiterDate("13-Apr-26")).toBe("2026-04-13");
    expect(parseArbiterDate("13-Apr-99")).toBe("1999-04-13");
  });

  it("falls back to day-first only when the first number cannot be a month", () => {
    expect(parseArbiterDate("13/4/2026")).toBe("2026-04-13");
    // Genuinely ambiguous stays US month-first, matching Arbiter's origin.
    expect(parseArbiterDate("5/4/2026")).toBe("2026-05-04");
  });

  it("returns empty rather than guessing at junk", () => {
    expect(parseArbiterDate("")).toBe("");
    expect(parseArbiterDate("TBD")).toBe("");
    expect(parseArbiterDate("Week 3")).toBe("");
  });
});

describe("parseArbiterTime", () => {
  it("reads the 12h forms these files use", () => {
    expect(parseArbiterTime("6:00PM")).toBe("18:00");
    expect(parseArbiterTime("6:00 pm")).toBe("18:00");
    expect(parseArbiterTime("6PM")).toBe("18:00");
    expect(parseArbiterTime("6:00p")).toBe("18:00");
    expect(parseArbiterTime("10:30AM")).toBe("10:30");
  });

  it("handles midnight and noon without flipping them", () => {
    expect(parseArbiterTime("12:00AM")).toBe("00:00");
    expect(parseArbiterTime("12:00PM")).toBe("12:00");
  });

  it("passes 24h times through", () => {
    expect(parseArbiterTime("18:00")).toBe("18:00");
    expect(parseArbiterTime("09:15")).toBe("09:15");
  });

  it("returns empty for unusable input rather than defaulting to midnight", () => {
    expect(parseArbiterTime("")).toBe("");
    expect(parseArbiterTime("TBD")).toBe("");
    expect(parseArbiterTime("25:00")).toBe("");
  });
});

describe("parseScore", () => {
  it("reads real scores", () => {
    expect(parseScore("12")).toBe(12);
    expect(parseScore("0")).toBe(0);
  });

  it("treats blanks and placeholders as not-yet-played, not zero", () => {
    expect(parseScore("")).toBeNull();
    expect(parseScore("-")).toBeNull();
    expect(parseScore("TBD")).toBeNull();
  });

  it("treats LCYBL's double-forfeit 'B' marker as no score", () => {
    // A trailing B means the score was never called in. Recording it as a
    // real number would publish a fabricated result.
    expect(parseScore("5B")).toBeNull();
    expect(parseScore("5 b")).toBeNull();
  });
});

describe("parseArbiterSchedule", () => {
  const csv = [
    "Game,Date,Time,Site,Away Team,Away Score,Home Team,Home Score",
    "372,13-Apr-26,6:00PM,Fuhrman Park #2,Donegal Green,12,Cedar Crest,2",
    "373,14-Apr-26,6:00PM,Cedar Hill,Hempfield Black,,Solanco Black,",
  ].join("\n");

  it("parses the real-world row shape", () => {
    const res = parseArbiterSchedule(csv);
    expect(res.errors).toEqual([]);
    expect(res.rows).toHaveLength(2);
    expect(res.rows[0]).toMatchObject({
      gameNumber: "372",
      date: "2026-04-13",
      time: "18:00",
      field: "Fuhrman Park #2",
      awayName: "Donegal Green",
      awayScore: 12,
      homeName: "Cedar Crest",
      homeScore: 2,
    });
    // Unplayed game keeps null scores rather than 0-0.
    expect(res.rows[1]!.awayScore).toBeNull();
    expect(res.rows[1]!.homeScore).toBeNull();
  });

  it("accepts tab-separated paste out of Excel", () => {
    const tsv = csv.replace(/,/g, "\t");
    const res = parseArbiterSchedule(tsv);
    expect(res.delimiter).toBe("\t");
    expect(res.rows).toHaveLength(2);
  });

  it("matches column aliases rather than one fixed spelling", () => {
    const alt = [
      "Game #,Game Date,Start Time,Location,Visitor,Home",
      "10,4/13/2026,6:00 PM,Field 1,Team A,Team B",
    ].join("\n");
    const res = parseArbiterSchedule(alt);
    expect(res.errors).toEqual([]);
    expect(res.rows[0]).toMatchObject({
      gameNumber: "10",
      date: "2026-04-13",
      time: "18:00",
      field: "Field 1",
      awayName: "Team A",
      homeName: "Team B",
    });
  });

  it("reports missing required columns instead of importing nothing silently", () => {
    const res = parseArbiterSchedule("Foo,Bar\n1,2");
    expect(res.rows).toHaveLength(0);
    expect(res.errors[0]!.message).toMatch(/date/i);
  });

  it("warns when there is no game number to key re-imports on", () => {
    const res = parseArbiterSchedule(
      "Date,Site,Away Team,Home Team\n13-Apr-26,Field 1,A,B",
    );
    expect(res.rows).toHaveLength(1);
    expect(res.warnings.join(" ")).toMatch(/game.?number/i);
  });

  it("skips spreadsheet spacer rows without erroring on each", () => {
    const withBlanks = [
      "Game,Date,Time,Site,Away Team,Home Team",
      "1,13-Apr-26,6:00PM,F1,A,B",
      ",,,,,",
      "2,14-Apr-26,6:00PM,F1,C,D",
    ].join("\n");
    const res = parseArbiterSchedule(withBlanks);
    expect(res.rows).toHaveLength(2);
    expect(res.errors).toEqual([]);
  });

  it("reports an unreadable date on its own line number", () => {
    const bad = [
      "Game,Date,Time,Site,Away Team,Home Team",
      "1,not-a-date,6:00PM,F1,A,B",
    ].join("\n");
    const res = parseArbiterSchedule(bad);
    expect(res.rows).toHaveLength(0);
    expect(res.errors[0]!.line).toBe(2);
  });

  it("lists columns it ignored so nothing is silently dropped", () => {
    const extra = [
      "Game,Date,Site,Away Team,Home Team,Umpire 1,Notes",
      "1,13-Apr-26,F1,A,B,Smith,something",
    ].join("\n");
    const res = parseArbiterSchedule(extra);
    expect(res.ignoredColumns).toContain("umpire 1");
    expect(res.ignoredColumns).toContain("notes");
  });
});

describe("matchTeamNames", () => {
  const teams: MatchableTeam[] = [
    { id: "hempfield-black", name: "Hempfield Black" },
    { id: "hempfield-blue", name: "Hempfield Blue" },
    { id: "st-leos", name: "St. Leo's", aliases: ["Crusaders"] },
    { id: "donegal-green", name: "Donegal Green", abbrev: "DG" },
  ];

  it("matches an exact name", () => {
    const [m] = matchTeamNames(["Hempfield Black"], teams);
    expect(m).toMatchObject({ teamId: "hempfield-black", confidence: "exact" });
  });

  it("matches through punctuation and spacing differences", () => {
    const [m] = matchTeamNames(["St Leos"], teams);
    expect(m).toMatchObject({ teamId: "st-leos", confidence: "normalized" });
  });

  it("matches a configured alias", () => {
    const [m] = matchTeamNames(["Crusaders"], teams);
    expect(m).toMatchObject({ teamId: "st-leos", confidence: "alias" });
  });

  it("refuses to guess between near-identical names", () => {
    // "Hempfield" alone must NOT silently become Black or Blue.
    const [m] = matchTeamNames(["Hempfield"], teams);
    expect(m!.teamId).toBeNull();
    expect(["none", "ambiguous"]).toContain(m!.confidence);
  });

  it("reports an unknown team rather than inventing one", () => {
    const [m] = matchTeamNames(["Some New Club"], teams);
    expect(m).toMatchObject({ teamId: null, confidence: "none" });
  });

  it("returns one entry per distinct source name", () => {
    const res = matchTeamNames(
      ["Hempfield Black", "Hempfield Black", "Hempfield Blue"],
      teams,
    );
    expect(res).toHaveLength(2);
  });
});

describe("export back to Arbiter", () => {
  const teams: MatchableTeam[] = [
    { id: "a", name: "Donegal Green" },
    { id: "b", name: "Cedar Crest" },
  ];

  it("renders dates and times in the form Arbiter emits", () => {
    expect(toDisplayDate("2026-04-13")).toBe("13-Apr-26");
    expect(toDisplayTime("18:00")).toBe("6:00 PM");
    expect(toDisplayTime("")).toBe("");
  });

  it("resolves team ids back to names", () => {
    const csv = toArbiterCsv(
      [
        {
          arbiter_game_number: "372",
          date: "2026-04-13",
          time: "18:00",
          field: "Fuhrman Park #2",
          away_team_id: "a",
          home_team_id: "b",
          away_score: 12,
          home_score: 2,
        },
      ],
      teams,
    );
    expect(csv).toContain("Donegal Green");
    expect(csv).toContain("Cedar Crest");
    expect(csv).not.toMatch(/,a,/);
  });

  it("round-trips: export then re-import gives the same games back", () => {
    const games = [
      {
        arbiter_game_number: "372",
        date: "2026-04-13",
        time: "18:00",
        field: "Fuhrman Park #2",
        away_team_id: "a",
        home_team_id: "b",
        away_score: 12,
        home_score: 2,
      },
      {
        arbiter_game_number: "373",
        date: "2026-04-14",
        time: "10:30",
        field: "Cedar Hill",
        away_team_id: "b",
        home_team_id: "a",
        away_score: null,
        home_score: null,
      },
    ];
    const reparsed = parseArbiterSchedule(toArbiterCsv(games, teams));
    expect(reparsed.errors).toEqual([]);
    expect(reparsed.rows).toHaveLength(2);
    expect(reparsed.rows[0]).toMatchObject({
      gameNumber: "372",
      date: "2026-04-13",
      time: "18:00",
      awayName: "Donegal Green",
      awayScore: 12,
      homeScore: 2,
    });
    expect(reparsed.rows[1]!.awayScore).toBeNull();
  });

  it("quotes fields containing commas", () => {
    const csv = toArbiterCsv(
      [
        {
          date: "2026-04-13",
          field: "Park #2, North",
          away_team_id: "a",
          home_team_id: "b",
        },
      ],
      teams,
    );
    expect(csv).toContain('"Park #2, North"');
    expect(parseArbiterSchedule(csv).rows[0]!.field).toBe("Park #2, North");
  });
});

describe("arbiterGameId", () => {
  it("keys on the game number so a re-import updates instead of duplicating", () => {
    const id1 = arbiterGameId({ gameNumber: "372", date: "2026-04-13", awayTeamId: "a", homeTeamId: "b" });
    // Same game, rescheduled to a new date, still the same Arbiter game.
    const id2 = arbiterGameId({ gameNumber: "372", date: "2026-05-01", awayTeamId: "a", homeTeamId: "b" });
    expect(id1).toBe(id2);
  });

  it("falls back to a natural key when there is no game number", () => {
    const id = arbiterGameId({ date: "2026-04-13", awayTeamId: "a", homeTeamId: "b" });
    expect(id).toBe("arb-20260413-a-b");
  });

  it("produces ids safe to use as Firestore doc ids", () => {
    const id = arbiterGameId({ gameNumber: "12/A #3", date: "2026-04-13", awayTeamId: "a", homeTeamId: "b" });
    expect(id).toMatch(/^[a-z0-9-]+$/);
  });
});
