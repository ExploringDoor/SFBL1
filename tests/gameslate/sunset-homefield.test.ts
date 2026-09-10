import { describe, it, expect } from "vitest";
import { generateSchedule, sunsetMinutes } from "@/lib/gameslate/schedule-generator";

const PHL = { lat: 39.95, lng: -75.17 };
const EDT = -240;

describe("sunset math", () => {
  it("lands within a few minutes of the almanac for Philadelphia", () => {
    // June 21 2026 sunset 8:33 PM EDT, October 15 2026 6:22 PM EDT.
    expect(Math.abs(sunsetMinutes("2026-06-21", PHL.lat, PHL.lng, EDT)! - (20 * 60 + 33))).toBeLessThanOrEqual(6);
    expect(Math.abs(sunsetMinutes("2026-10-15", PHL.lat, PHL.lng, EDT)! - (18 * 60 + 22))).toBeLessThanOrEqual(6);
  });
  it("returns null above the arctic circle in June", () => {
    expect(sunsetMinutes("2026-06-21", 78, 15, 120)).toBeNull();
  });
});

describe("fields without lights", () => {
  const teams = ["A", "B", "C", "D"].map((n) => ({ id: n, name: n }));
  it("drops start times that would run past sunset, and only for located fields", () => {
    const res = generateSchedule({
      teams,
      startDate: "2026-10-05",
      weeks: 3,
      daysOfWeek: [1, 2, 3, 4, 5],
      gameMinutes: 90,
      tzOffsetMinutes: EDT,
      fields: [
        { name: "Dark", times: ["15:00", "16:30", "18:00", "19:30"], noLights: true, ...PHL },
        { name: "Unlocated", times: ["19:30"], noLights: true },
      ],
    });
    const dark = res.games.filter((g) => g.field === "Dark");
    expect(dark.length).toBeGreaterThan(0);
    // Mid October sunset is about 6:20 PM, so nothing after 4:30 PM on the dark field.
    for (const g of dark) expect(g.time <= "16:30").toBe(true);
    expect(res.games.some((g) => g.field === "Unlocated" && g.time === "19:30")).toBe(true);
  });
});

describe("home field rule", () => {
  const teams = [
    { id: "A", name: "A", homeField: "Park A" },
    { id: "B", name: "B", homeField: "Park B" },
    { id: "C", name: "C", homeField: "Park C" },
    { id: "D", name: "D" },
  ];
  const fields = ["Park A", "Park B", "Park C", "Neutral"].map((n) => ({ name: n, times: ["18:00", "19:45"] }));
  it("require: every game is at the host's home field when the host has one", () => {
    const res = generateSchedule({ teams, startDate: "2026-05-04", weeks: 6, daysOfWeek: [1, 2, 3, 4], fields, homeFieldRule: "require" });
    expect(res.games.length).toBeGreaterThan(0);
    for (const g of res.games) {
      const host = teams.find((t) => t.id === g.home_team_id)!;
      if (host.homeField) expect(g.field).toBe(host.homeField);
      else expect(g.field).toBe(teams.find((t) => t.id === g.away_team_id)!.homeField);
    }
    expect(res.games.some((g) => g.field === "Neutral")).toBe(false);
  });
  it("prefer: the neutral field is still allowed", () => {
    const res = generateSchedule({ teams, startDate: "2026-05-04", weeks: 6, daysOfWeek: [1], fields: [fields[3]!] });
    expect(res.games.length).toBeGreaterThan(0);
  });
});

describe("special dates join the calendar", () => {
  const teams = ["A", "B", "C", "D"].map((n) => ({ id: n, name: n }));
  it("pins a Saturday opening day for a weeknight league", () => {
    const res = generateSchedule({
      teams, startDate: "2026-09-01", weeks: 4, daysOfWeek: [2, 4],
      fields: [{ name: "F", times: ["18:00", "19:45"] }],
      extraDates: ["2026-09-05"],
      requiredMatchups: [{ a: "A", b: "B", date: "2026-09-05", label: "Opening Day" }, { a: "C", b: "D", date: "2026-09-05", label: "Opening Day" }],
    });
    const opening = res.games.filter((g) => g.date === "2026-09-05");
    expect(opening.length).toBe(2);
    expect(opening.every((g) => g.label === "Opening Day" && g.required)).toBe(true);
    // No other games sneak onto that Saturday beyond the pinned ones.
    expect(res.games.filter((g) => g.date === "2026-09-05").length).toBe(2);
  });
});
