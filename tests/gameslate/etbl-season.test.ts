import { describe, expect, it } from "vitest";
import { buildWithGameslate, type GameslateResult } from "@/lib/gameslate/adapter";
import { DEFAULT_GAMESLATE_RULES } from "@/lib/gameslate/rules";
import { findConflicts, type ConflictGame } from "@/lib/schedule-conflicts";

// ETBL's real shape, end to end through the adapter, the way the admin does
// it: one division at a time, each run fitting around the ones already on the
// calendar. 96 teams in six divisions of sixteen, drawn from seven towns, in
// eight gyms, Saturdays only, 75-minute games from 9:00 to 3:15.
//
// A single round robin of sixteen is fifteen Saturdays of eight games per
// division: 48 games a Saturday, which is exactly what eight gyms with six
// slots hold. The season below has seventeen playable Saturdays, so there is
// a little slack, and Thanksgiving, Boxing Day and New Year's are off.

const TOWNS = ["Mineola", "Quitman", "Alba", "Grand Saline", "Lindale", "Winnsboro", "Hawkins"];
const COLORS = ["Red", "Blue", "White", "Gold"];
const DIVISIONS = [
  ["3rd Grade Boys", "3B"],
  ["3rd Grade Girls", "3G"],
  ["4th Grade Boys", "4B"],
  ["4th Grade Girls", "4G"],
  ["5th-6th Grade Boys", "56B"],
  ["5th-6th Grade Girls", "56G"],
] as const;
const TIMES = ["09:00", "10:15", "11:30", "12:45", "14:00", "15:15"];
const GYMS = [...TOWNS.map((t) => `${t} Gym`), "Mineola Gym 2"].map((name) => ({
  name,
  times: TIMES,
}));

const START = "2026-11-07";
const END = "2027-03-20";
const OFF = ["2026-11-28", "2026-12-26", "2027-01-02"];

function divisionTeams(code: string) {
  return Array.from({ length: 16 }, (_, k) => {
    const town = TOWNS[k % TOWNS.length]!;
    return {
      id: `t-${town.toLowerCase().replace(/\s+/g, "-")}-${code.toLowerCase()}-${COLORS[Math.floor(k / TOWNS.length)]!.toLowerCase()}`,
      name: `${town} ${code} ${COLORS[Math.floor(k / TOWNS.length)]}`,
      // Every team's home gym is its town's gym, as a preference. What the
      // engine does when both teams have one is the host-choice list.
      homeField: `${town} Gym`,
    };
  });
}

function buildSeason(): { runs: GameslateResult[]; all: ConflictGame[] } {
  const all: ConflictGame[] = [];
  const runs: GameslateResult[] = [];
  for (const [name, code] of DIVISIONS) {
    const r = buildWithGameslate({
      teams: divisionTeams(code),
      startDate: START,
      endDate: END,
      daysOfWeek: [6],
      blackoutDates: OFF,
      fields: GYMS,
      blockedPairs: [],
      division: name,
      gamesPerWeek: 1,
      gamesPerTeam: 0,
      weeklyPairing: "different-opponents",
      existingGames: all,
      rules: {
        ...DEFAULT_GAMESLATE_RULES,
        cycles: 1,
        gameMinutes: 75,
        maxPerTeamPerDay: 1,
        homeFieldRule: "prefer",
      },
      seed: 1,
    });
    runs.push(r);
    r.games.forEach((g, i) =>
      all.push({
        id: `${code}-${i}`,
        date: g.date,
        time: g.time,
        field: g.field,
        away_team_id: g.away_team_id,
        home_team_id: g.home_team_id,
        division: g.division,
      }),
    );
  }
  return { runs, all };
}

describe("ETBL season through the GameSlate engine", () => {
  const { runs, all } = buildSeason();

  it("every division is a complete single round robin", () => {
    for (const r of runs) {
      expect(r.games).toHaveLength(120);
      expect(r.everyPairPlayed).toBe(true);
      expect(r.unscheduled).toEqual([]);
      expect(r.noLegalField).toEqual([]);
      expect(r.gamesPerTeamActual.every((t) => t.games === 15)).toBe(true);
    }
    expect(all).toHaveLength(720);
  });

  it("no gym and no team is booked twice at once, across all six divisions", () => {
    const conflicts = findConflicts(all, { existingGames: [], teams: [], gameMinutes: 75 });
    const blocking = conflicts.filter((c) => c.severity === "error");
    expect(blocking.map((c) => c.message)).toEqual([]);
  });

  it("nobody plays twice on a Saturday, and nothing lands on an off day", () => {
    const perDay = new Map<string, number>();
    for (const g of all) {
      expect(OFF).not.toContain(g.date);
      expect(new Date(`${g.date}T12:00:00Z`).getUTCDay()).toBe(6);
      for (const id of [g.home_team_id, g.away_team_id]) {
        const k = `${id}|${g.date}`;
        perDay.set(k, (perDay.get(k) ?? 0) + 1);
      }
    }
    expect(Math.max(...perDay.values())).toBe(1);
  });

  it("uses only the gyms and start times the league has", () => {
    const gymNames = new Set(GYMS.map((g) => g.name));
    for (const g of all) {
      expect(gymNames.has(g.field ?? "")).toBe(true);
      expect(TIMES).toContain(g.time ?? "");
    }
  });

  it("grades each division and flags the games where both towns could host", () => {
    for (const r of runs) {
      expect(r.quality.grade).toMatch(/^[A-F]$/);
      // Teams from different towns both have a home gym, so nearly every
      // game is a host choice; same-town games are not.
      expect(r.homeFieldChoices.length).toBeGreaterThan(90);
      for (const c of r.homeFieldChoices) {
        expect(c.aField).not.toBe(c.bField);
        expect(r.games[c.game]!.field).toBe(c.chosen);
      }
    }
  });

  it("the whole league fits in the calendar with room to spare", () => {
    const saturdays = new Set(all.map((g) => g.date));
    expect(saturdays.size).toBeGreaterThanOrEqual(15);
    expect(saturdays.size).toBeLessThanOrEqual(17);
  });
});
