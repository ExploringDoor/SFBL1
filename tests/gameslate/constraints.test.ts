// gameslate additions: the Diamond Scheduler class constraints.
// Kept out of schedule-generator.test.ts so that file stays a verbatim copy
// of league-platform's.
import { describe, it, expect } from "vitest";
import { generateSchedule, type GeneratedGame } from "@/lib/gameslate/schedule-generator";

const teams = (n: number, extra: object = {}) =>
  Array.from({ length: n }, (_, i) => ({ id: `T${i + 1}`, name: `T${i + 1}`, ...extra }));

const gamesOf = (games: GeneratedGame[], id: string) =>
  games.filter((g) => g.away_team_id === id || g.home_team_id === id);

const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

describe("coach conflicts (linkedTeamIds)", () => {
  const base = {
    startDate: "2026-04-14",
    daysOfWeek: [2],
    weeks: 6,
    gameMinutes: 60,
    fields: [
      { name: "F1", times: ["17:30", "19:00"] },
      { name: "F2", times: ["17:30", "19:00"] },
    ],
  };

  it("linked teams never play at overlapping times", () => {
    const r = generateSchedule({ ...base, teams: teams(4), linkedTeamIds: [["T1", "T3"]] });
    const byDate: Record<string, number[]> = {};
    for (const g of r.games) {
      // One entry per GAME touching the pair: T1 vs T3 head to head is one
      // game, not an overlap.
      const involves = ["T1", "T3"].some(
        (id) => g.away_team_id === id || g.home_team_id === id,
      );
      if (involves) (byDate[g.date] ??= []).push(mins(g.time));
    }
    for (const starts of Object.values(byDate)) {
      starts.sort((a, b) => a - b);
      for (let i = 1; i < starts.length; i++) {
        expect(starts[i]! - starts[i - 1]!).toBeGreaterThanOrEqual(60);
      }
    }
  });

  it("holds across divisions through existingGames", () => {
    const linked = [["T1", "X1"]];
    const div1 = generateSchedule({ ...base, teams: teams(4), linkedTeamIds: linked, division: "A" });
    const div2 = generateSchedule({
      ...base,
      teams: Array.from({ length: 4 }, (_, i) => ({ id: `X${i + 1}`, name: `X${i + 1}` })),
      linkedTeamIds: linked,
      division: "B",
      existingGames: div1.games,
    });
    const t1 = gamesOf(div1.games, "T1");
    const x1 = gamesOf(div2.games, "X1");
    for (const a of t1) {
      for (const b of x1) {
        if (a.date !== b.date) continue;
        expect(Math.abs(mins(a.time) - mins(b.time))).toBeGreaterThanOrEqual(60);
      }
    }
  });
});

describe("day rules", () => {
  const weekend = {
    startDate: "2026-04-18",
    daysOfWeek: [6],
    weeks: 4,
    gameMinutes: 60,
    gamesPerWeek: 2,
    weeklyPairing: "different-opponents" as const,
    fields: [{ name: "F1", times: ["09:00", "10:30", "12:00", "13:30", "15:00", "16:30"] }],
  };

  it("maxPerTeamPerDay caps a team's games in one day", () => {
    const r = generateSchedule({ ...weekend, teams: teams(4), maxPerTeamPerDay: 1 });
    const perDay: Record<string, number> = {};
    for (const g of r.games) {
      for (const id of [g.away_team_id, g.home_team_id]) {
        const k = g.date + "|" + id;
        perDay[k] = (perDay[k] ?? 0) + 1;
        expect(perDay[k]).toBeLessThanOrEqual(1);
      }
    }
  });

  it("minGapMinutes keeps same-day games apart", () => {
    const r = generateSchedule({ ...weekend, teams: teams(4), minGapMinutes: 60 });
    const byDayTeam: Record<string, number[]> = {};
    for (const g of r.games) {
      for (const id of [g.away_team_id, g.home_team_id]) {
        (byDayTeam[g.date + "|" + id] ??= []).push(mins(g.time));
      }
    }
    for (const starts of Object.values(byDayTeam)) {
      starts.sort((a, b) => a - b);
      for (let i = 1; i < starts.length; i++) {
        // end of previous (start + 60) to next start must be >= 60
        expect(starts[i]! - (starts[i - 1]! + 60)).toBeGreaterThanOrEqual(60);
      }
    }
  });

  it("maxGapMinutes keeps a team's Saturday compact", () => {
    const r = generateSchedule({ ...weekend, teams: teams(4), maxGapMinutes: 90 });
    const byDayTeam: Record<string, number[]> = {};
    for (const g of r.games) {
      for (const id of [g.away_team_id, g.home_team_id]) {
        (byDayTeam[g.date + "|" + id] ??= []).push(mins(g.time));
      }
    }
    for (const starts of Object.values(byDayTeam)) {
      starts.sort((a, b) => a - b);
      for (let i = 1; i < starts.length; i++) {
        expect(starts[i]! - (starts[i - 1]! + 60)).toBeLessThanOrEqual(90);
      }
    }
  });

  it("minDaysRest keeps Tuesday teams off Thursday", () => {
    const r = generateSchedule({
      startDate: "2026-04-14",
      daysOfWeek: [2, 4],
      weeks: 6,
      gamesPerWeek: 2,
      weeklyPairing: "different-opponents",
      minDaysRest: 3,
      teams: teams(6),
      fields: [
        { name: "F1", times: ["17:30", "19:00"] },
        { name: "F2", times: ["17:30", "19:00"] },
      ],
    });
    const dates: Record<string, Set<string>> = {};
    for (const g of r.games) {
      for (const id of [g.away_team_id, g.home_team_id]) (dates[id] ??= new Set()).add(g.date);
    }
    const dayNum = (iso: string) => {
      const [y, m, d] = iso.split("-").map(Number);
      return Math.floor(Date.UTC(y!, m! - 1, d!, 12) / 86400000);
    };
    for (const ds of Object.values(dates)) {
      const sorted = [...ds].map(dayNum).sort((a, b) => a - b);
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i]! - sorted[i - 1]!).toBeGreaterThanOrEqual(3);
      }
    }
  });
});

describe("per-team time windows", () => {
  it("earliestTime keeps the late-arriving team out of the 5:30 slot", () => {
    const r = generateSchedule({
      startDate: "2026-04-14",
      daysOfWeek: [2],
      weeks: 6,
      teams: [
        { id: "T1", name: "T1", earliestTime: "19:00" },
        ...teams(3).map((t, i) => ({ ...t, id: `T${i + 2}`, name: `T${i + 2}` })),
      ],
      fields: [{ name: "F1", times: ["17:30", "19:00"] }, { name: "F2", times: ["17:30", "19:00"] }],
    });
    for (const g of gamesOf(r.games, "T1")) {
      expect(mins(g.time)).toBeGreaterThanOrEqual(mins("19:00"));
    }
    expect(gamesOf(r.games, "T1").length).toBeGreaterThan(0);
  });
});

describe("slot and field preferences", () => {
  it("early preference uses the first slot for a single game", () => {
    const r = generateSchedule({
      startDate: "2026-04-14",
      daysOfWeek: [2],
      weeks: 1,
      slotPreference: "early",
      teams: teams(2),
      fields: [{ name: "F1", times: ["09:00", "12:00", "15:00"] }],
    });
    expect(r.games.length).toBe(1);
    expect(r.games[0]!.time).toBe("09:00");
  });

  it("late preference uses the last slot", () => {
    const r = generateSchedule({
      startDate: "2026-04-14",
      daysOfWeek: [2],
      weeks: 1,
      slotPreference: "late",
      teams: teams(2),
      fields: [{ name: "F1", times: ["09:00", "12:00", "15:00"] }],
    });
    expect(r.games[0]!.time).toBe("15:00");
  });

  it("prioritizeFieldOrder fills the showcase field first", () => {
    const r = generateSchedule({
      startDate: "2026-04-14",
      daysOfWeek: [2],
      weeks: 1,
      prioritizeFieldOrder: true,
      teams: teams(2),
      fields: [
        { name: "Showcase", times: ["17:30"] },
        { name: "Backlot", times: ["17:30"] },
      ],
    });
    expect(r.games[0]!.field).toBe("Showcase");
  });
});
