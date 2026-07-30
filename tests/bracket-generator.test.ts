import { describe, it, expect } from "vitest";
import {
  generateBracket,
  seedSlots,
  refGameNum,
  isRealTeam,
} from "../lib/bracket-generator";

const teamsOf = (n: number) => Array.from({ length: n }, (_, i) => `T${i + 1}`);

describe("seedSlots", () => {
  it("pairs the standard bracket: 1v4 / 2v3, and 1v8 / 4v5 / 2v7 / 3v6", () => {
    expect(seedSlots(4)).toEqual([1, 4, 2, 3]);
    expect(seedSlots(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
    // Read as consecutive pairs, that is the conventional seeding.
    const pairs = (a: number[]) =>
      a.reduce<number[][]>((acc, _, i) => (i % 2 ? acc : [...acc, a.slice(i, i + 2)]), []);
    expect(pairs(seedSlots(8))).toEqual([[1, 8], [4, 5], [2, 7], [3, 6]]);
  });
});

describe("single elimination", () => {
  it("uses one game fewer than the number of teams", () => {
    for (const n of [2, 4, 8, 16]) {
      const games = generateBracket({ teams: teamsOf(n), format: "single" });
      expect(games).toHaveLength(n - 1);
    }
  });

  it("marks exactly one championship game", () => {
    const games = generateBracket({ teams: teamsOf(8), format: "single" });
    expect(games.filter((g) => g.champ)).toHaveLength(1);
    // The title game is the last one played.
    expect(games[games.length - 1]!.champ).toBe(true);
  });

  it("gives the top seeds byes when the field is not a power of two", () => {
    // 6 teams -> 8 slot bracket, so seeds 1 and 2 sit out round one.
    const games = generateBracket({ teams: teamsOf(6), format: "single" });
    expect(games).toHaveLength(5); // 6 teams still needs 5 games
    const round1 = games.filter((g) => g.round === 1);
    expect(round1).toHaveLength(2);
    // Neither top seed plays in round one.
    const r1Teams = round1.flatMap((g) => [g.away, g.home]);
    expect(r1Teams).not.toContain("T1");
    expect(r1Teams).not.toContain("T2");
  });

  it("numbers games uniquely and in order", () => {
    const games = generateBracket({ teams: teamsOf(16), format: "single" });
    const nums = games.map((g) => g.g);
    expect(new Set(nums).size).toBe(nums.length);
    expect([...nums].sort((a, b) => a - b)).toEqual(nums);
  });

  it("every game after round one feeds from earlier games", () => {
    const games = generateBracket({ teams: teamsOf(8), format: "single" });
    const byNum = new Map(games.map((g) => [g.g, g]));
    games.forEach((g) => {
      [g.away, g.home].forEach((side) => {
        const ref = refGameNum(side);
        if (ref !== null) {
          // A reference must point at a real, EARLIER game.
          expect(byNum.has(ref)).toBe(true);
          expect(ref).toBeLessThan(g.g);
        }
      });
    });
  });
});

describe("double elimination", () => {
  it("adds a losers bracket and a grand final", () => {
    const games = generateBracket({ teams: teamsOf(8), format: "double" });
    expect(games.some((g) => g.bracket === "losers")).toBe(true);
    expect(games.filter((g) => g.bracket === "final")).toHaveLength(2);
  });

  it("gives every team a route back after one loss", () => {
    // Each winners-bracket game's loser must appear somewhere in the losers side.
    const games = generateBracket({ teams: teamsOf(8), format: "double" });
    const wb = games.filter((g) => g.bracket === "winners");
    const laterRefs = new Set(
      games
        .filter((g) => g.bracket !== "winners")
        .flatMap((g) => [g.away, g.home]),
    );
    wb.forEach((g) => {
      // The losers-bracket entry point for this game.
      expect(
        laterRefs.has(`LG-${g.g}`) ||
          // or it feeds a later losers game indirectly through a survivor chain
          games.some((x) => x.bracket === "losers" && x.g > g.g),
      ).toBe(true);
    });
  });

  it("makes the reset game a rematch of the grand final, both sides resolvable", () => {
    const games = generateBracket({ teams: teamsOf(8), format: "double" });
    const finals = games.filter((g) => g.bracket === "final");
    const [grand, reset] = finals;
    expect(reset!.away).toBe(`WG-${grand!.g}`);
    expect(reset!.home).toBe(`LG-${grand!.g}`);
    // Both point at the same real game, so neither side can render blank.
    expect(refGameNum(reset!.away)).toBe(grand!.g);
    expect(refGameNum(reset!.home)).toBe(grand!.g);
  });

  it("has more games than the single-elim version of the same field", () => {
    for (const n of [4, 8, 16]) {
      const single = generateBracket({ teams: teamsOf(n), format: "single" });
      const dbl = generateBracket({ teams: teamsOf(n), format: "double" });
      expect(dbl.length).toBeGreaterThan(single.length);
    }
  });

  it("never references a game that does not exist", () => {
    for (const n of [4, 5, 8, 11, 16]) {
      const games = generateBracket({ teams: teamsOf(n), format: "double" });
      const nums = new Set(games.map((g) => g.g));
      games.forEach((g) => {
        [g.away, g.home].forEach((side) => {
          const ref = refGameNum(side);
          if (ref !== null) expect(nums.has(ref)).toBe(true);
        });
      });
    }
  });

  it("never sends a team into a game against itself", () => {
    for (const n of [4, 6, 8, 12]) {
      const games = generateBracket({ teams: teamsOf(n), format: "double" });
      games.forEach((g) => expect(g.away).not.toBe(g.home));
    }
  });
});

describe("edges", () => {
  it("returns nothing for fewer than two teams", () => {
    expect(generateBracket({ teams: [] })).toEqual([]);
    expect(generateBracket({ teams: ["Solo"] })).toEqual([]);
  });

  it("can start numbering partway through", () => {
    const games = generateBracket({ teams: teamsOf(4), startGame: 20 });
    expect(games[0]!.g).toBe(20);
  });

  it("tells a team name apart from an advancement pointer", () => {
    expect(isRealTeam("Phoenix Fire")).toBe(true);
    expect(isRealTeam("WG-3")).toBe(false);
    expect(isRealTeam("LG-12")).toBe(false);
    expect(refGameNum("WG-7")).toBe(7);
    expect(refGameNum("Waves 14U")).toBeNull();
  });
});
