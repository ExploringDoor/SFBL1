// gameslate addition: a field with no lights cannot start late in the spring.
import { describe, it, expect } from "vitest";
import { generateSchedule } from "@/lib/gameslate/schedule-generator";

const teams = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `T${i + 1}`, name: `T${i + 1}` }));
const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

describe("field latestStart window (lights)", () => {
  it("drops late starts inside the window and allows them after it", () => {
    const r = generateSchedule({
      startDate: "2026-04-07",
      daysOfWeek: [2],
      weeks: 10,
      gameMinutes: 90,
      teams: teams(4),
      fields: [{ name: "Dusk Park", times: ["17:30", "19:30"], latestStart: "18:00", latestStartFrom: "2026-04-01", latestStartUntil: "2026-05-01" }],
    });
    expect(r.games.length).toBeGreaterThan(0);
    for (const g of r.games) {
      if (g.date <= "2026-05-01") expect(mins(g.time)).toBeLessThanOrEqual(mins("18:00"));
    }
    expect(r.games.some((g) => g.date > "2026-05-01" && g.time === "19:30")).toBe(true);
  });
});
