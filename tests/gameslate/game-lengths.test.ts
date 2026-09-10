import { describe, it, expect } from "vitest";
import { findConflicts } from "@/lib/gameslate/schedule-conflicts";
import { generateSchedule } from "@/lib/gameslate/schedule-generator";

describe("per game lengths in conflict checks", () => {
  it("a 105 minute game and a 60 minute game are each checked at their own size", () => {
    const long = { date: "2026-05-02", time: "18:00", field: "F", away_team_id: "A14", home_team_id: "B14", minutes: 105 };
    const shortOk = { date: "2026-05-02", time: "19:45", field: "F", away_team_id: "A8", home_team_id: "B8", minutes: 60 };
    const shortBad = { date: "2026-05-02", time: "19:30", field: "F", away_team_id: "C8", home_team_id: "D8", minutes: 60 };
    expect(findConflicts([long, shortOk], { gameMinutes: 60 }).filter((c) => c.kind === "field_double_booked").length).toBe(0);
    expect(findConflicts([long, shortBad], { gameMinutes: 60 }).filter((c) => c.kind === "field_double_booked").length).toBe(1);
    // A short game before a long one only needs its own 60 minutes.
    const first = { date: "2026-05-02", time: "17:00", field: "F", away_team_id: "E8", home_team_id: "G8", minutes: 60 };
    expect(findConflicts([first, long], { gameMinutes: 105 }).filter((c) => c.kind === "field_double_booked").length).toBe(0);
  });
  it("the generator schedules around another division's longer game at its real length", () => {
    const teams = ["A", "B"].map((n) => ({ id: n, name: n }));
    const res = generateSchedule({
      teams, startDate: "2026-05-02", weeks: 1, daysOfWeek: [6], gameMinutes: 60,
      fields: [{ name: "F", times: ["18:00", "19:00", "19:30", "20:00"] }],
      existingGames: [{ date: "2026-05-02", time: "18:00", field: "F", away_team_id: "X", home_team_id: "Y", minutes: 105 }],
    });
    expect(res.games.length).toBe(1);
    expect(res.games[0]!.time >= "19:45" || res.games[0]!.time === "20:00").toBe(true);
    expect(res.games[0]!.time).toBe("20:00");
  });
});

describe("pins to a time and field", () => {
  it("lands the pinned game exactly where asked", () => {
    const teams = ["A", "B", "C", "D"].map((n) => ({ id: n, name: n }));
    const res = generateSchedule({
      teams, startDate: "2026-05-02", weeks: 3, daysOfWeek: [6],
      fields: [{ name: "Main", times: ["09:00", "11:00"] }, { name: "Back", times: ["09:00", "11:00"] }],
      requiredMatchups: [{ a: "A", b: "B", date: "2026-05-09", time: "11:00", field: "Main", label: "Rivalry" }],
    });
    const g = res.games.find((x) => x.label === "Rivalry")!;
    expect(g).toBeTruthy();
    expect([g.date, g.time, g.field]).toEqual(["2026-05-09", "11:00", "Main"]);
  });
});
