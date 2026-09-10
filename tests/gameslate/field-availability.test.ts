// gameslate addition: per-field date availability (school field frees up
// mid-season, field only on Saturdays, field closed for maintenance).
import { describe, it, expect } from "vitest";
import { generateSchedule } from "@/lib/gameslate/schedule-generator";

const teams = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `T${i + 1}`, name: `T${i + 1}` }));

describe("per-field date availability", () => {
  it("does not use a field before its availableFrom date", () => {
    const r = generateSchedule({
      startDate: "2026-04-14",
      daysOfWeek: [2, 4],
      weeks: 12,
      teams: teams(6),
      fields: [
        { name: "Main", times: ["17:30", "19:00"] },
        { name: "School", times: ["17:30", "19:00"], availableFrom: "2026-05-05" },
      ],
    });
    const schoolGames = r.games.filter((g) => g.field === "School");
    expect(schoolGames.length).toBeGreaterThan(0);
    for (const g of schoolGames) expect(g.date >= "2026-05-05").toBe(true);
  });

  it("does not use a field after its availableUntil date", () => {
    const r = generateSchedule({
      startDate: "2026-04-14",
      daysOfWeek: [2, 4],
      weeks: 12,
      teams: teams(6),
      fields: [
        { name: "Main", times: ["17:30", "19:00"] },
        { name: "Permit", times: ["17:30", "19:00"], availableUntil: "2026-05-01" },
      ],
    });
    const permit = r.games.filter((g) => g.field === "Permit");
    expect(permit.length).toBeGreaterThan(0);
    for (const g of permit) expect(g.date <= "2026-05-01").toBe(true);
  });

  it("restricts a field to certain weekdays", () => {
    const r = generateSchedule({
      startDate: "2026-04-14",
      daysOfWeek: [2, 4, 6], // Tue, Thu, Sat
      weeks: 12,
      teams: teams(6),
      fields: [
        { name: "Weeknight", times: ["17:30", "19:00"] },
        { name: "Saturday only", times: ["09:00", "10:30"], days: [6] },
      ],
    });
    const sat = r.games.filter((g) => g.field === "Saturday only");
    expect(sat.length).toBeGreaterThan(0);
    for (const g of sat) {
      const [y, m, d] = g.date.split("-").map(Number);
      const dow = new Date(Date.UTC(y!, m! - 1, d!, 12)).getUTCDay();
      expect(dow).toBe(6);
    }
  });

  it("honors a field-specific closure date", () => {
    const r = generateSchedule({
      startDate: "2026-04-14",
      daysOfWeek: [2, 4],
      weeks: 12,
      teams: teams(6),
      fields: [
        { name: "F1", times: ["17:30", "19:00"] },
        { name: "F2", times: ["17:30", "19:00"], closedDates: ["2026-04-16"] },
      ],
    });
    const f2OnClosed = r.games.filter(
      (g) => g.field === "F2" && g.date === "2026-04-16",
    );
    expect(f2OnClosed.length).toBe(0);
    // F1 still plays that date.
    const anyOn16 = r.games.filter((g) => g.date === "2026-04-16");
    expect(anyOn16.length).toBeGreaterThan(0);
  });

  it("still schedules a whole season when one field is limited", () => {
    const r = generateSchedule({
      startDate: "2026-04-14",
      daysOfWeek: [2, 4],
      weeks: 16,
      teams: teams(6),
      maxCycles: 1,
      fields: [
        { name: "Main", times: ["17:30", "19:00"] },
        { name: "School", times: ["17:30"], availableFrom: "2026-05-05" },
      ],
    });
    expect(r.everyPairPlayed).toBe(true);
  });

  it("pins a required game onto a field only when that field is open", () => {
    const r = generateSchedule({
      startDate: "2026-04-14",
      daysOfWeek: [2, 4],
      weeks: 12,
      teams: teams(6),
      fields: [
        { name: "School", times: ["17:30"], availableFrom: "2026-05-05" },
        { name: "Main", times: ["17:30"] },
      ],
      requiredMatchups: [{ a: "T1", b: "T2", date: "2026-04-14" }],
    });
    const pinned = r.games.find((g) => g.required)!;
    // Opening day is before School opens, so the pin must land on Main.
    expect(pinned.field).toBe("Main");
  });
});
