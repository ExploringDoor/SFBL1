import { describe, it, expect } from "vitest";
import { computeRpi, type RpiGame } from "../../lib/rpi";

const final = (home: string, away: string, hs: number, as: number): RpiGame => ({
  home_team_id: home,
  away_team_id: away,
  home_score: hs,
  away_score: as,
  status: "final",
});

describe("computeRpi — 3-team round robin", () => {
  // A beats B and C; B beats C. A=2-0, B=1-1, C=0-2.
  const games = [final("A", "B", 5, 1), final("A", "C", 6, 2), final("B", "C", 4, 3)];
  const rows = computeRpi(games);
  const by = Object.fromEntries(rows.map((r) => [r.team_id, r]));

  it("ranks A > B > C", () => {
    expect(rows.map((r) => r.team_id)).toEqual(["A", "B", "C"]);
  });
  it("computes the documented RPI values", () => {
    // WP: A=1.0 B=0.5 C=0.0; OWP/OOWP all 0.5 in a balanced round robin.
    expect(by.A!.rpi).toBeCloseTo(0.625, 5); // .25*1 + .5*.5 + .25*.5
    expect(by.B!.rpi).toBeCloseTo(0.5, 5); // .25*.5 + .5*.5 + .25*.5
    expect(by.C!.rpi).toBeCloseTo(0.375, 5); // .25*0 + .5*.5 + .25*.5
  });
  it("records W/L", () => {
    expect([by.A!.w, by.A!.l]).toEqual([2, 0]);
    expect([by.C!.w, by.C!.l]).toEqual([0, 2]);
  });
});

describe("computeRpi — strength of schedule", () => {
  // X and Y are both 1-0. X beat a strong team (S, 2-1); Y beat a weak team
  // (W, 0-3). RPI should rank X above Y despite identical records.
  const games = [
    final("X", "S", 3, 2), // X beats strong S
    final("S", "A1", 7, 0),
    final("S", "A2", 7, 0), // S otherwise 2-0 -> strong
    final("Y", "W", 3, 2), // Y beats weak W
    final("B1", "W", 9, 0),
    final("B2", "W", 9, 0), // W otherwise 0-2 -> weak
  ];
  const rows = computeRpi(games);
  const by = Object.fromEntries(rows.map((r) => [r.team_id, r]));

  it("X (beat a strong team) outranks Y (beat a weak team), same record", () => {
    expect(by.X!.w).toBe(1);
    expect(by.Y!.w).toBe(1);
    expect(by.X!.rpi).toBeGreaterThan(by.Y!.rpi);
    expect(by.X!.owp).toBeGreaterThan(by.Y!.owp);
  });
});

describe("computeRpi — ties and game filtering", () => {
  it("counts a tie as half a win", () => {
    const rows = computeRpi([final("A", "B", 4, 4), final("A", "B", 6, 2)]);
    const a = rows.find((r) => r.team_id === "A")!;
    expect([a.w, a.l, a.t]).toEqual([1, 0, 1]);
    expect(a.wp).toBeCloseTo(0.75, 5); // (1 + 0.5) / 2
  });
  it("ignores non-final games", () => {
    const games: RpiGame[] = [
      final("A", "B", 5, 1),
      { home_team_id: "A", away_team_id: "C", home_score: 0, away_score: 0, status: "scheduled" },
      { home_team_id: "A", away_team_id: "D", home_score: 99, away_score: 0, status: "draft" },
    ];
    const a = computeRpi(games).find((r) => r.team_id === "A")!;
    expect(a.gp).toBe(1); // only the final counts
  });
});
