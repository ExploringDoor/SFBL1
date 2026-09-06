// Both teams have a home field, so somebody travels.
//
// Mike, 2026-09-06: "if a team has a home field it will automatically put them
// there. But if it's playing a team that also has a field then it will notify
// me to choose."
//
// One home field is an answer and the generator should just apply it. Two is a
// question, and the generator is not the one who should be answering it. It
// still picks, so the preview is a complete schedule, and reports the game so
// the pick can be taken back.

import { describe, expect, it } from "vitest";
import { generateSchedule, type GeneratorTeam } from "@/lib/schedule-generator";

const FIELDS = [
  { name: "Cedar Hill", times: ["17:30", "19:00"] },
  { name: "Riverhead", times: ["17:30", "19:00"] },
];
const team = (id: string, homeField?: string): GeneratorTeam => ({
  id,
  name: id.toUpperCase(),
  ...(homeField ? { homeField } : {}),
});
const run = (teams: GeneratorTeam[]) =>
  generateSchedule({
    teams,
    startDate: "2026-09-14",
    weeks: 8,
    daysOfWeek: [1],
    fields: FIELDS,
    gamesPerTeam: 2,
  });

describe("one team has a home field", () => {
  it("puts the game there and makes them the home side, with nothing to ask", () => {
    const res = run([team("a", "Cedar Hill"), team("b"), team("c"), team("d")]);
    const theirs = res.games.filter(
      (g) => g.home_team_id === "a" || g.away_team_id === "a",
    );
    expect(theirs.length).toBeGreaterThan(0);
    for (const g of theirs) {
      if (g.field === "Cedar Hill") expect(g.home_team_id).toBe("a");
    }
    expect(res.homeFieldChoices).toEqual([]);
  });

  it("asks nothing when nobody has a home field", () => {
    expect(run([team("a"), team("b"), team("c"), team("d")]).homeFieldChoices).toEqual(
      [],
    );
  });

  it("asks nothing when two teams SHARE a home field, since there is no clash", () => {
    const res = run([
      team("a", "Cedar Hill"),
      team("b", "Cedar Hill"),
      team("c"),
      team("d"),
    ]);
    for (const c of res.homeFieldChoices) {
      expect([c.a, c.b].sort()).not.toEqual(["a", "b"]);
    }
  });
});

describe("both teams have a home field", () => {
  const res = run([
    team("a", "Cedar Hill"),
    team("b", "Riverhead"),
    team("c"),
    team("d"),
  ]);
  const clash = res.homeFieldChoices.filter(
    (c) => [c.a, c.b].sort().join("|") === "a|b",
  );

  it("reports the game rather than silently deciding", () => {
    expect(clash.length).toBeGreaterThan(0);
  });

  it("still places the game, so the preview is a whole schedule", () => {
    const played = res.games.some(
      (g) =>
        (g.home_team_id === "a" && g.away_team_id === "b") ||
        (g.home_team_id === "b" && g.away_team_id === "a"),
    );
    expect(played).toBe(true);
  });

  it("names both fields and which one it went with", () => {
    const c = clash[0]!;
    expect([c.aField, c.bField].sort()).toEqual(["Cedar Hill", "Riverhead"]);
    expect([c.aField, c.bField]).toContain(c.chosen);
  });

  it("points at a real fixture, so the admin can rewrite exactly that game", () => {
    for (const c of res.homeFieldChoices) {
      const g = res.games[c.game];
      expect(g).toBeDefined();
      expect([g!.home_team_id, g!.away_team_id].sort()).toEqual([c.a, c.b].sort());
      expect(g!.date).toBe(c.date);
    }
  });

  it("carries the names, so the panel does not have to look them up", () => {
    for (const c of res.homeFieldChoices) {
      expect(c.aName).toBe(c.a.toUpperCase());
      expect(c.bName).toBe(c.b.toUpperCase());
    }
  });
});
