import { describe, it, expect } from "vitest";
import {
  generateSchedule,
  roundRobinRounds,
  addDays,
  type GeneratorTeam,
} from "../lib/schedule-generator";

const team = (id: string, organization?: string): GeneratorTeam => ({
  id,
  name: id,
  organization,
});

describe("roundRobinRounds", () => {
  it("pairs every team exactly once with an even count", () => {
    const rounds = roundRobinRounds(["a", "b", "c", "d"]);
    expect(rounds).toHaveLength(3); // n-1
    const pairs = rounds.flat().map(([x, y]) => [x, y].sort().join("|")).sort();
    expect(pairs).toEqual(["a|b", "a|c", "a|d", "b|c", "b|d", "c|d"]);
  });

  it("gives each team a bye and still covers every pair with an odd count", () => {
    const ids = ["a", "b", "c", "d", "e"];
    const rounds = roundRobinRounds(ids);
    expect(rounds).toHaveLength(5);
    // 5 teams -> 10 distinct pairs, one team idle per round
    const pairs = new Set(rounds.flat().map(([x, y]) => [x, y].sort().join("|")));
    expect(pairs.size).toBe(10);
    rounds.forEach((r) => expect(r).toHaveLength(2));
  });

  it("never pairs a team with itself", () => {
    for (const n of [2, 3, 6, 7, 12]) {
      const ids = Array.from({ length: n }, (_, i) => `t${i}`);
      roundRobinRounds(ids)
        .flat()
        .forEach(([a, b]) => expect(a).not.toBe(b));
    }
  });
});

describe("addDays", () => {
  it("advances a week without drifting across a DST boundary", () => {
    // US DST starts 2026-03-08; a naive local-midnight parse can slip a day.
    expect(addDays("2026-03-01", 7)).toBe("2026-03-08");
    expect(addDays("2026-03-08", 7)).toBe("2026-03-15");
    expect(addDays("2026-11-01", 7)).toBe("2026-11-08");
  });

  it("rolls over month and year ends", () => {
    expect(addDays("2026-08-29", 7)).toBe("2026-09-05");
    expect(addDays("2026-12-28", 7)).toBe("2027-01-04");
  });
});

describe("generateSchedule", () => {
  const base = {
    startDate: "2026-09-12",
    fields: ["Field 1", "Field 2"],
    times: ["17:30", "19:00"],
  };

  it("lets everyone play everyone at least once when given enough weeks", () => {
    const teams = ["a", "b", "c", "d", "e", "f"].map((id) => team(id));
    const res = generateSchedule({ ...base, teams, weeks: 5 });
    expect(res.everyPairPlayed).toBe(true);
    const pairs = new Set(
      res.games.map((g) => [g.home_team_id, g.away_team_id].sort().join("|")),
    );
    expect(pairs.size).toBe(15); // 6 teams -> 15 pairs
  });

  it("never schedules two teams from the same organization", () => {
    const teams = [
      team("fire-steel", "Phoenix Fire"),
      team("fire-silver", "Phoenix Fire"),
      team("fire-gray", "Phoenix Fire"),
      team("brentwood-a", "Brentwood"),
      team("brentwood-b", "Brentwood"),
      team("waves", "Riverhead"),
    ];
    const res = generateSchedule({ ...base, teams, weeks: 5 });
    const orgById = new Map(teams.map((t) => [t.id, t.organization]));
    res.games.forEach((g) => {
      expect(orgById.get(g.home_team_id)).not.toBe(orgById.get(g.away_team_id));
    });
    // Phoenix Fire has 3 internal pairs, Brentwood 1 -> 4 skipped.
    expect(res.skippedSameOrg).toHaveLength(4);
  });

  it("treats a blank organization as no club, so those teams may meet", () => {
    const teams = [team("a"), team("b", ""), team("c", "   "), team("d")];
    const res = generateSchedule({ ...base, teams, weeks: 3 });
    expect(res.skippedSameOrg).toHaveLength(0);
    expect(res.everyPairPlayed).toBe(true);
  });

  it("spaces weeks seven days apart and numbers them from 1", () => {
    const teams = ["a", "b", "c", "d"].map((id) => team(id));
    const res = generateSchedule({ ...base, teams, weeks: 3 });
    const wk = (n: number) => res.games.filter((g) => g.week === n);
    expect(wk(1)[0]!.date).toBe("2026-09-12");
    expect(wk(2)[0]!.date).toBe("2026-09-19");
    expect(wk(3)[0]!.date).toBe("2026-09-26");
  });

  it("never double-books a field and time in the same week", () => {
    const teams = Array.from({ length: 8 }, (_, i) => team(`t${i}`));
    const res = generateSchedule({
      ...base,
      teams,
      weeks: 7,
      fields: ["F1", "F2"],
      times: ["17:30", "19:00"],
    });
    const seen = new Set<string>();
    res.games.forEach((g) => {
      const slot = `${g.date}|${g.time}|${g.field}`;
      expect(seen.has(slot)).toBe(false);
      seen.add(slot);
    });
  });

  // How many games a team plays in a week is Mike's input, not a rule the
  // generator gets to impose. His weekend divisions play doubleheaders.
  const gamesPerTeamInWeek = (
    games: { week: number; home_team_id: string; away_team_id: string }[],
    week: number,
    teamId: string,
  ) =>
    games.filter(
      (g) =>
        g.week === week &&
        (g.home_team_id === teamId || g.away_team_id === teamId),
    );

  it("single format gives each team one game a week", () => {
    const teams = Array.from({ length: 8 }, (_, i) => team(`t${i}`));
    const res = generateSchedule({ ...base, teams, weeks: 7, weeklyFormat: "single" });
    for (const t of teams) {
      expect(gamesPerTeamInWeek(res.games, 1, t.id)).toHaveLength(1);
    }
  });

  it("doubleheader gives each team two games a week against the same opponent", () => {
    const teams = Array.from({ length: 6 }, (_, i) => team(`t${i}`));
    const res = generateSchedule({
      ...base,
      teams,
      weeks: 5,
      fields: ["F1", "F2", "F3"],
      times: ["09:00", "10:30"],
      weeklyFormat: "doubleheader",
    });
    for (const t of teams) {
      const wk1 = gamesPerTeamInWeek(res.games, 1, t.id);
      expect(wk1).toHaveLength(2);
      // Same opponent both games, and both on one field back to back.
      const opponents = wk1.map((g) =>
        g.home_team_id === t.id ? g.away_team_id : g.home_team_id,
      );
      expect(opponents[0]).toBe(opponents[1]);
      expect(new Set(wk1.map((g: any) => g.field)).size).toBe(1);
      expect(new Set(wk1.map((g: any) => g.time)).size).toBe(2);
    }
  });

  it("doubleheader alternates home and away across the two games", () => {
    const teams = ["a", "b"].map((id) => team(id));
    const res = generateSchedule({
      ...base,
      teams,
      weeks: 1,
      weeklyFormat: "doubleheader",
    });
    expect(res.games).toHaveLength(2);
    expect(res.games[0]!.home_team_id).toBe(res.games[1]!.away_team_id);
  });

  it("two-opponents gives each team two games a week against different teams", () => {
    const teams = Array.from({ length: 8 }, (_, i) => team(`t${i}`));
    const res = generateSchedule({
      ...base,
      teams,
      weeks: 3,
      fields: ["F1", "F2", "F3", "F4"],
      times: ["17:30", "19:00"],
      weeklyFormat: "two-opponents",
    });
    for (const t of teams) {
      const wk1 = gamesPerTeamInWeek(res.games, 1, t.id);
      expect(wk1).toHaveLength(2);
      const opponents = wk1.map((g) =>
        g.home_team_id === t.id ? g.away_team_id : g.home_team_id,
      );
      expect(opponents[0]).not.toBe(opponents[1]);
    }
  });

  it("reports matchups it could not fit instead of dropping them silently", () => {
    const teams = Array.from({ length: 8 }, (_, i) => team(`t${i}`));
    // 4 games a round but only 1 slot a week.
    const res = generateSchedule({
      ...base,
      teams,
      weeks: 7,
      fields: ["Only Field"],
      times: ["17:30"],
    });
    expect(res.unscheduled.length).toBeGreaterThan(0);
    expect(res.everyPairPlayed).toBe(false);
    expect(res.warnings.join(" ")).toMatch(/no slot/i);
  });

  it("warns when the season is too short to cover every pair", () => {
    const teams = Array.from({ length: 6 }, (_, i) => team(`t${i}`));
    const res = generateSchedule({ ...base, teams, weeks: 2 });
    expect(res.everyPairPlayed).toBe(false);
    expect(res.warnings.join(" ")).toMatch(/not enough/i);
  });

  it("flips home and away on the second pass through the league", () => {
    const teams = ["a", "b"].map((id) => team(id));
    // 2 teams -> 1 round, so week 2 is the second cycle.
    const res = generateSchedule({ ...base, teams, weeks: 2 });
    expect(res.games).toHaveLength(2);
    expect(res.games[0]!.home_team_id).toBe(res.games[1]!.away_team_id);
    expect(res.games[0]!.away_team_id).toBe(res.games[1]!.home_team_id);
  });

  it("is deterministic: same inputs, same schedule", () => {
    const teams = Array.from({ length: 7 }, (_, i) => team(`t${i}`));
    const a = generateSchedule({ ...base, teams, weeks: 6 });
    const b = generateSchedule({ ...base, teams, weeks: 6 });
    expect(a.games).toEqual(b.games);
  });

  it("refuses to build with fewer than two teams or no slots", () => {
    expect(generateSchedule({ ...base, teams: [team("a")], weeks: 4 }).games).toHaveLength(0);
    expect(
      generateSchedule({
        ...base,
        teams: [team("a"), team("b")],
        weeks: 4,
        fields: [],
      }).games,
    ).toHaveLength(0);
  });
});
