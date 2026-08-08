import { describe, it, expect } from "vitest";
import {
  findUmpireIssues,
  eligibleUmpires,
  assignmentCounts,
  minutesOf,
  type Umpire,
  type AssignableGame,
} from "../lib/umpires";

const ump = (id: string, over: Partial<Umpire> = {}): Umpire => ({
  id,
  name: id.toUpperCase(),
  ...over,
});

const game = (
  id: string,
  date: string,
  time: string,
  field: string,
  umpires: string[] = [],
): AssignableGame => ({ id, date, time, field, umpires });

describe("minutesOf", () => {
  it("parses valid times and rejects junk", () => {
    expect(minutesOf("17:30")).toBe(1050);
    expect(minutesOf("")).toBeNull();
    expect(minutesOf("25:00")).toBeNull();
  });
});

describe("findUmpireIssues — double booking", () => {
  it("flags one umpire assigned to two games at the same time", () => {
    const issues = findUmpireIssues(
      [
        game("g1", "2026-05-02", "17:30", "Cedar Hill", ["u1"]),
        game("g2", "2026-05-02", "17:30", "Mondauk 4", ["u1"]),
      ],
      [ump("u1")],
    );
    const dbl = issues.filter((i) => i.kind === "double_booked");
    expect(dbl).toHaveLength(1);
    expect(dbl[0]!.severity).toBe("error");
    expect(dbl[0]!.gameIds.sort()).toEqual(["g1", "g2"]);
  });

  it("allows the same umpire to work two games at different times", () => {
    const issues = findUmpireIssues(
      [
        game("g1", "2026-05-02", "17:30", "Cedar Hill", ["u1"]),
        game("g2", "2026-05-02", "19:30", "Cedar Hill", ["u1"]),
      ],
      [ump("u1")],
    );
    expect(issues.filter((i) => i.kind === "double_booked")).toHaveLength(0);
  });

  it("catches back-to-back games once a game length is given", () => {
    const issues = findUmpireIssues(
      [
        game("g1", "2026-05-02", "17:30", "Cedar Hill", ["u1"]),
        game("g2", "2026-05-02", "18:15", "Cedar Hill", ["u1"]),
      ],
      [ump("u1")],
      { gameMinutes: 105 },
    );
    expect(issues.filter((i) => i.kind === "double_booked")).toHaveLength(1);
  });

  it("warns rather than errors when a time is missing", () => {
    const issues = findUmpireIssues(
      [
        game("g1", "2026-05-02", "", "Cedar Hill", ["u1"]),
        game("g2", "2026-05-02", "17:30", "Mondauk 4", ["u1"]),
      ],
      [ump("u1")],
    );
    expect(issues[0]!.kind).toBe("missing_time");
    expect(issues[0]!.severity).toBe("warning");
  });
});

describe("findUmpireIssues — availability and travel", () => {
  it("flags an umpire working a date they blocked out", () => {
    const issues = findUmpireIssues(
      [game("g1", "2026-05-25", "17:30", "Cedar Hill", ["u1"])],
      [ump("u1", { unavailable: ["2026-05-25"] })],
    );
    expect(issues.some((i) => i.kind === "unavailable")).toBe(true);
  });

  it("flags a field the umpire does not cover", () => {
    const issues = findUmpireIssues(
      [game("g1", "2026-05-02", "17:30", "Far Park", ["u1"])],
      [ump("u1", { fields: ["Cedar Hill"] })],
    );
    expect(issues.some((i) => i.kind === "field_not_travelled")).toBe(true);
  });

  it("treats an umpire with no field list as travelling anywhere", () => {
    const issues = findUmpireIssues(
      [game("g1", "2026-05-02", "17:30", "Anywhere", ["u1"])],
      [ump("u1")],
    );
    expect(issues).toHaveLength(0);
  });
});

describe("findUmpireIssues — staffing", () => {
  it("says nothing about staffing unless a requirement is set", () => {
    const issues = findUmpireIssues(
      [game("g1", "2026-05-02", "17:30", "Cedar Hill", [])],
      [],
    );
    expect(issues).toHaveLength(0);
  });

  it("warns when a game has fewer umpires than required", () => {
    const issues = findUmpireIssues(
      [game("g1", "2026-05-02", "17:30", "Cedar Hill", ["u1"])],
      [ump("u1")],
      { requiredPerGame: 2 },
    );
    const under = issues.filter((i) => i.kind === "understaffed");
    expect(under).toHaveLength(1);
    expect(under[0]!.severity).toBe("warning");
  });
});

describe("eligibleUmpires", () => {
  const all = [
    game("g1", "2026-05-02", "17:30", "Cedar Hill", ["busy"]),
    game("g2", "2026-05-02", "17:30", "Mondauk 4", []),
  ];
  const roster = [
    ump("free"),
    ump("busy"),
    ump("away", { unavailable: ["2026-05-02"] }),
    ump("local", { fields: ["Cedar Hill"] }),
    ump("retired", { active: false }),
  ];

  it("excludes umpires already working at that time", () => {
    const ok = eligibleUmpires(all[1]!, roster, all).map((u) => u.id);
    expect(ok).not.toContain("busy");
  });

  it("excludes unavailable, inactive, and non-travelling umpires", () => {
    const ok = eligibleUmpires(all[1]!, roster, all).map((u) => u.id);
    expect(ok).not.toContain("away");
    expect(ok).not.toContain("retired");
    expect(ok).not.toContain("local"); // only covers Cedar Hill, g2 is Mondauk
    expect(ok).toContain("free");
  });

  it("offers the least-loaded umpire first so work spreads", () => {
    const games = [
      game("a", "2026-06-01", "17:30", "F1", ["heavy"]),
      game("b", "2026-06-02", "17:30", "F1", ["heavy"]),
      game("c", "2026-06-03", "17:30", "F1", ["light"]),
      game("d", "2026-06-04", "17:30", "F1", []),
    ];
    const ok = eligibleUmpires(games[3]!, [ump("heavy"), ump("light")], games);
    expect(ok[0]!.id).toBe("light");
  });

  it("does not offer someone already on this very game", () => {
    const g = game("g", "2026-05-02", "17:30", "F1", ["free"]);
    const ok = eligibleUmpires(g, [ump("free")], [g]).map((u) => u.id);
    expect(ok).not.toContain("free");
  });
});

describe("assignmentCounts", () => {
  it("counts games per umpire and keeps unassigned officials visible", () => {
    const rows = assignmentCounts(
      [ump("a"), ump("b")],
      [
        game("g1", "2026-05-02", "17:30", "F1", ["a"]),
        game("g2", "2026-05-03", "17:30", "F1", ["a"]),
      ],
    );
    expect(rows[0]).toMatchObject({ count: 2 });
    expect(rows[0]!.umpire.id).toBe("a");
    // "b" has none but must still appear, or a forgotten umpire is invisible.
    expect(rows.find((r) => r.umpire.id === "b")?.count).toBe(0);
  });
});
