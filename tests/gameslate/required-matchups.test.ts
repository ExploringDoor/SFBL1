// gameslate addition: required matchups (opening day, rivalry week).
import { describe, it, expect } from "vitest";
import { generateSchedule } from "@/lib/gameslate/schedule-generator";

const teams = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `T${i + 1}`, name: `T${i + 1}` }));

const base = {
  startDate: "2026-04-14", // a Tuesday
  daysOfWeek: [2, 4], // Tue, Thu
  weeks: 12,
  fields: [
    { name: "F1", times: ["17:30", "19:00"] },
    { name: "F2", times: ["17:30", "19:00"] },
  ],
};

const key = (g: { away_team_id: string; home_team_id: string }) =>
  [g.away_team_id, g.home_team_id].sort().join("|");

describe("required matchups", () => {
  it("pins a matchup to a specific date", () => {
    const r = generateSchedule({
      ...base,
      teams: teams(6),
      maxCycles: 1,
      requiredMatchups: [{ a: "T1", b: "T2", date: "2026-04-14", label: "Opening Day" }],
    });
    const pinned = r.games.filter((g) => g.required);
    expect(pinned.length).toBe(1);
    expect(pinned[0]!.date).toBe("2026-04-14");
    expect([pinned[0]!.away_team_id, pinned[0]!.home_team_id].sort()).toEqual(["T1", "T2"]);
    expect(pinned[0]!.label).toBe("Opening Day");
  });

  it("still schedules the pinned pair exactly once, not twice", () => {
    const r = generateSchedule({
      ...base,
      teams: teams(6),
      maxCycles: 1,
      requiredMatchups: [{ a: "T1", b: "T2", date: "2026-04-14" }],
    });
    const counts: Record<string, number> = {};
    for (const g of r.games) counts[key(g)] = (counts[key(g)] ?? 0) + 1;
    expect(counts["T1|T2"]).toBe(1);
    // and every other pair still meets once
    expect(Object.keys(counts).length).toBe(15);
    for (const n of Object.values(counts)) expect(n).toBe(1);
  });

  it("pins a whole rivalry week to one week", () => {
    const r = generateSchedule({
      ...base,
      teams: teams(8),
      maxCycles: 1,
      requiredMatchups: [
        { a: "T1", b: "T2", week: 3, label: "Rivalry Week" },
        { a: "T3", b: "T4", week: 3, label: "Rivalry Week" },
        { a: "T5", b: "T6", week: 3, label: "Rivalry Week" },
      ],
    });
    const pinned = r.games.filter((g) => g.required);
    expect(pinned.length).toBe(3);
    for (const g of pinned) {
      expect(g.week).toBe(3);
      expect(g.label).toBe("Rivalry Week");
    }
  });

  it("never double books a pinned slot", () => {
    const r = generateSchedule({
      ...base,
      teams: teams(6),
      maxCycles: 1,
      gameMinutes: 60,
      requiredMatchups: [
        { a: "T1", b: "T2", date: "2026-04-14" },
        { a: "T3", b: "T4", date: "2026-04-14" },
      ],
    });
    const slots: Record<string, number> = {};
    for (const g of r.games) {
      const s = g.date + "|" + g.time + "|" + g.field;
      slots[s] = (slots[s] ?? 0) + 1;
      expect(slots[s]).toBeLessThanOrEqual(1);
    }
    // and no team is double-booked at a time
    const busy: Record<string, number> = {};
    for (const g of r.games) {
      for (const t of [g.away_team_id, g.home_team_id]) {
        const k = g.date + "|" + g.time + "|" + t;
        busy[k] = (busy[k] ?? 0) + 1;
        expect(busy[k]).toBeLessThanOrEqual(1);
      }
    }
  });

  it("warns and falls back when the target has no free slot", () => {
    // One field, one time: opening day holds a single slot, but Tue+Thu over
    // 12 weeks gives plenty of room for the un-pinned pair elsewhere.
    const r = generateSchedule({
      startDate: "2026-04-14",
      daysOfWeek: [2, 4],
      weeks: 12,
      teams: teams(6),
      maxCycles: 1,
      fields: [{ name: "F1", times: ["17:30"] }],
      requiredMatchups: [
        { a: "T1", b: "T2", date: "2026-04-14" },
        { a: "T3", b: "T4", date: "2026-04-14" }, // no room, same lone slot
      ],
    });
    const pinnedOnOpening = r.games.filter(
      (g) => g.required && g.date === "2026-04-14",
    );
    expect(pinnedOnOpening.length).toBe(1); // only one could fit
    expect(r.warnings.some((w) => /Could not pin/.test(w))).toBe(true);
    // the un-pinned pair is not silently lost: it is either scheduled
    // elsewhere or reported as unscheduled.
    const scheduled = r.games.some((g) => key(g) === "T3|T4");
    const reported = r.unscheduled.some(
      (u) => [u.a, u.b].map((x) => x.replace("T", "")).sort().join() === "3,4",
    );
    expect(scheduled || reported).toBe(true);
  });

  it("respects a team's home field for the pinned game", () => {
    const r = generateSchedule({
      ...base,
      teams: [
        { id: "T1", name: "T1" },
        { id: "T2", name: "T2", homeField: "F2" },
        ...teams(4).map((t, i) => ({ id: `T${i + 3}`, name: `T${i + 3}` })),
      ],
      maxCycles: 1,
      requiredMatchups: [{ a: "T1", b: "T2", date: "2026-04-14" }],
    });
    const g = r.games.find((x) => x.required)!;
    // T2 hosts on its home field F2.
    expect(g.field).toBe("F2");
    expect(g.home_team_id).toBe("T2");
  });
});
