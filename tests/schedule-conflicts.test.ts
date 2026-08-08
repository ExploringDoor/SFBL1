import { describe, it, expect } from "vitest";
import {
  findConflicts,
  legalFieldsFor,
  hasBlockingConflict,
  minutesOf,
  type ConflictGame,
  type ConflictTeam,
} from "../lib/schedule-conflicts";

const g = (
  date: string,
  time: string,
  field: string,
  away: string,
  home: string,
  extra: Partial<ConflictGame> = {},
): ConflictGame => ({
  date,
  time,
  field,
  away_team_id: away,
  home_team_id: home,
  ...extra,
});

const team = (id: string, over: Partial<ConflictTeam> = {}): ConflictTeam => ({
  id,
  name: id.toUpperCase(),
  ...over,
});

describe("minutesOf", () => {
  it("parses 24h times and rejects junk", () => {
    expect(minutesOf("17:30")).toBe(17 * 60 + 30);
    expect(minutesOf("9:05")).toBe(9 * 60 + 5);
    expect(minutesOf("00:00")).toBe(0);
    expect(minutesOf("")).toBeNull();
    expect(minutesOf(undefined)).toBeNull();
    expect(minutesOf("6pm")).toBeNull();
    expect(minutesOf("25:00")).toBeNull();
    expect(minutesOf("12:75")).toBeNull();
  });
});

describe("field double-booking", () => {
  it("flags two games on one field at the same time", () => {
    const conflicts = findConflicts([
      g("2026-04-18", "17:30", "Cedar Hill", "a", "b"),
      g("2026-04-18", "17:30", "Cedar Hill", "c", "d"),
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.kind).toBe("field_double_booked");
    expect(conflicts[0]!.severity).toBe("error");
    expect(conflicts[0]!.gameIndexes.sort()).toEqual([0, 1]);
  });

  it("allows back-to-back slots on one field when no duration is set", () => {
    const conflicts = findConflicts([
      g("2026-04-18", "17:30", "Cedar Hill", "a", "b"),
      g("2026-04-18", "19:00", "Cedar Hill", "c", "d"),
    ]);
    expect(conflicts).toHaveLength(0);
  });

  it("catches overlapping starts once a game length is given", () => {
    // 17:30 and 18:00 is a real conflict a youth game length exposes but
    // exact-start matching misses entirely.
    const conflicts = findConflicts(
      [
        g("2026-04-18", "17:30", "Cedar Hill", "a", "b"),
        g("2026-04-18", "18:00", "Cedar Hill", "c", "d"),
      ],
      { gameMinutes: 105 },
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.kind).toBe("field_double_booked");
  });

  it("still allows a genuine doubleheader gap at that game length", () => {
    const conflicts = findConflicts(
      [
        g("2026-04-18", "17:30", "Cedar Hill", "a", "b"),
        g("2026-04-18", "19:30", "Cedar Hill", "c", "d"),
      ],
      { gameMinutes: 105 },
    );
    expect(conflicts).toHaveLength(0);
  });

  it("treats differently-typed field names as the same field", () => {
    const conflicts = findConflicts([
      g("2026-04-18", "17:30", "Cedar Hill", "a", "b"),
      g("2026-04-18", "17:30", "  cedar   hill ", "c", "d"),
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.kind).toBe("field_double_booked");
  });

  it("does not collide games on different dates or different fields", () => {
    expect(
      findConflicts([
        g("2026-04-18", "17:30", "Cedar Hill", "a", "b"),
        g("2026-04-19", "17:30", "Cedar Hill", "c", "d"),
      ]),
    ).toHaveLength(0);
    expect(
      findConflicts([
        g("2026-04-18", "17:30", "Cedar Hill", "a", "b"),
        g("2026-04-18", "17:30", "Mondauk 4", "c", "d"),
      ]),
    ).toHaveLength(0);
  });

  it("ignores games with no field assigned", () => {
    const conflicts = findConflicts([
      g("2026-04-18", "17:30", "", "a", "b"),
      g("2026-04-18", "17:30", "", "c", "d"),
    ]);
    expect(conflicts.filter((c) => c.kind === "field_double_booked")).toHaveLength(0);
  });
});

describe("conflicts against games already stored", () => {
  it("catches a new game landing on an existing one, and blames the new row", () => {
    const conflicts = findConflicts(
      [g("2026-04-18", "17:30", "Cedar Hill", "c", "d")],
      {
        existingGames: [
          g("2026-04-18", "17:30", "Cedar Hill", "a", "b", { id: "existing1" }),
        ],
      },
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.kind).toBe("field_double_booked");
    expect(conflicts[0]!.gameIndexes).toEqual([0]);
    expect(conflicts[0]!.existingIds).toEqual(["existing1"]);
  });

  it("does not report two stored games conflicting with each other", () => {
    // Pre-existing damage must not make every later save fail.
    const conflicts = findConflicts([g("2026-05-01", "17:30", "Mondauk 4", "e", "f")], {
      existingGames: [
        g("2026-04-18", "17:30", "Cedar Hill", "a", "b", { id: "x1" }),
        g("2026-04-18", "17:30", "Cedar Hill", "c", "d", { id: "x2" }),
      ],
    });
    expect(conflicts).toHaveLength(0);
  });

  it("catches the cross-division collision that motivated this module", () => {
    // 10U Section One was generated first and took the slot; 12U Section One is
    // being generated now and cannot see it.
    const existingGames = [
      g("2026-04-18", "17:30", "Cedar Hill", "t10a", "t10b", {
        id: "g10",
        division: "10U Section One",
      }),
    ];
    const conflicts = findConflicts(
      [g("2026-04-18", "17:30", "Cedar Hill", "t12a", "t12b", { division: "12U Section One" })],
      { existingGames },
    );
    expect(hasBlockingConflict(conflicts)).toBe(true);
    expect(conflicts[0]!.kind).toBe("field_double_booked");
  });
});

describe("team double-booking", () => {
  it("flags a team in two places at once, on different fields", () => {
    const conflicts = findConflicts([
      g("2026-04-18", "17:30", "Cedar Hill", "a", "b"),
      g("2026-04-18", "17:30", "Mondauk 4", "a", "c"),
    ]);
    const teamConflicts = conflicts.filter((c) => c.kind === "team_double_booked");
    expect(teamConflicts).toHaveLength(1);
    expect(teamConflicts[0]!.teamIds).toEqual(["a"]);
    expect(teamConflicts[0]!.severity).toBe("error");
  });

  it("allows a team to play twice on one day at separate times", () => {
    const conflicts = findConflicts([
      g("2026-04-18", "17:30", "Cedar Hill", "a", "b"),
      g("2026-04-18", "19:30", "Cedar Hill", "a", "c"),
    ]);
    expect(conflicts.filter((c) => c.kind === "team_double_booked")).toHaveLength(0);
  });
});

describe("field eligibility", () => {
  const teams = [
    team("bigkids", { allowedFields: ["Cedar Hill", "Mondauk 4"] }),
    team("anyone"),
  ];

  it("blocks a team from a field outside its allowed set", () => {
    const conflicts = findConflicts(
      [g("2026-04-18", "17:30", "Tiny Park", "bigkids", "anyone")],
      { teams },
    );
    const bad = conflicts.filter((c) => c.kind === "field_not_allowed");
    expect(bad).toHaveLength(1);
    expect(bad[0]!.teamIds).toEqual(["bigkids"]);
    expect(bad[0]!.message).toContain("Cedar Hill");
  });

  it("permits a field inside the allowed set", () => {
    const conflicts = findConflicts(
      [g("2026-04-18", "17:30", "Cedar Hill", "bigkids", "anyone")],
      { teams },
    );
    expect(conflicts.filter((c) => c.kind === "field_not_allowed")).toHaveLength(0);
  });

  it("treats a team with no allowed list as unrestricted", () => {
    const conflicts = findConflicts(
      [g("2026-04-18", "17:30", "Anywhere At All", "anyone", "anyone2")],
      { teams: [team("anyone"), team("anyone2", { allowedFields: [] })] },
    );
    expect(conflicts.filter((c) => c.kind === "field_not_allowed")).toHaveLength(0);
  });
});

describe("team unavailability", () => {
  it("flags a game on a date the team blocked out", () => {
    const conflicts = findConflicts(
      [g("2026-05-25", "17:30", "Cedar Hill", "a", "b")],
      { teams: [team("a", { unavailable: ["2026-05-25"] }), team("b")] },
    );
    const bad = conflicts.filter((c) => c.kind === "team_unavailable");
    expect(bad).toHaveLength(1);
    expect(bad[0]!.teamIds).toEqual(["a"]);
  });
});

describe("missing start times", () => {
  it("warns rather than errors when a shared field has no time to compare", () => {
    const conflicts = findConflicts([
      g("2026-04-18", "", "Cedar Hill", "a", "b"),
      g("2026-04-18", "17:30", "Cedar Hill", "c", "d"),
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.kind).toBe("missing_time");
    expect(conflicts[0]!.severity).toBe("warning");
    expect(hasBlockingConflict(conflicts)).toBe(false);
  });
});

describe("legalFieldsFor", () => {
  const fields = ["Cedar Hill", "Mondauk 4", "Tiny Park"];

  it("returns every field when neither team is restricted", () => {
    expect(legalFieldsFor(team("a"), team("b"), fields)).toEqual(fields);
  });

  it("intersects two restricted teams", () => {
    const a = team("a", { allowedFields: ["Cedar Hill", "Mondauk 4"] });
    const b = team("b", { allowedFields: ["Mondauk 4", "Tiny Park"] });
    expect(legalFieldsFor(a, b, fields)).toEqual(["Mondauk 4"]);
  });

  it("limits to the restricted team when the opponent travels freely", () => {
    const a = team("a", { allowedFields: ["Tiny Park"] });
    expect(legalFieldsFor(a, team("b"), fields)).toEqual(["Tiny Park"]);
  });

  it("returns nothing when two teams share no legal field", () => {
    const a = team("a", { allowedFields: ["Cedar Hill"] });
    const b = team("b", { allowedFields: ["Tiny Park"] });
    expect(legalFieldsFor(a, b, fields)).toEqual([]);
  });
});

describe("ordering and gating", () => {
  it("sorts errors ahead of warnings", () => {
    const conflicts = findConflicts([
      g("2026-04-20", "", "Mondauk 4", "e", "f"),
      g("2026-04-20", "18:00", "Mondauk 4", "g2", "h"),
      g("2026-04-18", "17:30", "Cedar Hill", "a", "b"),
      g("2026-04-18", "17:30", "Cedar Hill", "c", "d"),
    ]);
    expect(conflicts.length).toBeGreaterThanOrEqual(2);
    expect(conflicts[0]!.severity).toBe("error");
    expect(conflicts[conflicts.length - 1]!.severity).toBe("warning");
  });

  it("reports a clean schedule as clean", () => {
    const conflicts = findConflicts([
      g("2026-04-18", "17:30", "Cedar Hill", "a", "b"),
      g("2026-04-18", "19:00", "Cedar Hill", "c", "d"),
      g("2026-04-18", "17:30", "Mondauk 4", "e", "f"),
    ]);
    expect(conflicts).toHaveLength(0);
    expect(hasBlockingConflict(conflicts)).toBe(false);
  });
});
