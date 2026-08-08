import { describe, it, expect } from "vitest";
import { deriveBracketRefs, type HistoricalGame } from "../lib/bracket-refs";
import { classify, championOutcome, parseRef } from "../lib/sts-bracket";

const g = (
  round: string,
  sideA: string,
  sideB: string,
  scoreA: number | null,
  scoreB: number | null,
): HistoricalGame => ({ round, sideA, sideB, scoreA, scoreB });

describe("deriveBracketRefs — advancement", () => {
  it("points a later slot at the game its team won", () => {
    const out = deriveBracketRefs([
      g("Game 1", "Alpha", "Bravo", 5, 3),
      g("Game 2", "Alpha", "Charlie", 7, 2),
    ]);
    // Alpha won G1, so its slot in G2 is the winner of G1.
    expect(out[1]!.away).toBe("WG-1");
    expect(out[1]!.home).toBe("Charlie"); // first appearance stays literal
  });

  it("points a losers-bracket slot at the game its team lost", () => {
    const out = deriveBracketRefs([
      g("Game 1", "Alpha", "Bravo", 5, 3),
      g("Game 2", "Charlie", "Delta", 4, 1),
      g("Game 3", "Bravo", "Delta", 6, 2),
    ]);
    expect(out[2]!.away).toBe("LG-1");
    expect(out[2]!.home).toBe("LG-2");
  });

  it("leaves a first-time team as a literal name", () => {
    const out = deriveBracketRefs([g("Game 1", "Alpha", "Bravo", 5, 3)]);
    expect(out[0]!.away).toBe("Alpha");
    expect(out[0]!.home).toBe("Bravo");
  });

  it("strips a printed seed when matching, but keeps it on the literal name", () => {
    const out = deriveBracketRefs([
      g("Game 1", "#D1 Hempfield Black", "#8 MT Streaks", 17, 5),
      g("Game 2", "Hempfield Black", "#4 PM Comets", 8, 7),
    ]);
    expect(out[0]!.away).toBe("#D1 Hempfield Black");
    expect(out[1]!.away).toBe("WG-1");
  });

  it("consumes each earlier result once, so one card never feeds two rounds", () => {
    const out = deriveBracketRefs([
      g("Game 1", "Alpha", "Bravo", 5, 3),
      g("Game 2", "Alpha", "Charlie", 7, 2),
      g("Game 3", "Alpha", "Delta", 9, 1),
    ]);
    expect(out[1]!.away).toBe("WG-1");
    // G3 must trace to G2 (the most recent win), not back to G1 again.
    expect(out[2]!.away).toBe("WG-2");
  });
});

describe("deriveBracketRefs — best-of-N series", () => {
  const series: HistoricalGame[] = [
    g("Series Game #1", "Alpha", "Bravo", 10, 8),
    g("Series Game #2", "Alpha", "Bravo", 7, 9),
    g("Series Game #3 (if needed)", "Alpha", "Bravo", 11, 1),
  ];

  it("collapses three rows for one matchup into a single node", () => {
    const out = deriveBracketRefs(series);
    expect(out).toHaveLength(1);
    expect(out[0]!.seriesGames).toHaveLength(3);
  });

  it("scores the node as the series tally, not the last game", () => {
    const out = deriveBracketRefs(series);
    expect(out[0]!.away_score).toBe(2);
    expect(out[0]!.home_score).toBe(1);
  });

  it("orients a game printed with the teams reversed", () => {
    const out = deriveBracketRefs([
      g("Series Game #1", "Alpha", "Bravo", 10, 8),
      // same matchup, sides swapped in the source
      g("Series Game #2", "Bravo", "Alpha", 9, 7),
    ]);
    expect(out).toHaveLength(1);
    // Alpha won game 1, Bravo won game 2 -> 1-1, not 2-0.
    expect(out[0]!.away_score).toBe(1);
    expect(out[0]!.home_score).toBe(1);
  });

  it("lets a series winner advance", () => {
    const out = deriveBracketRefs([
      ...series,
      g("LNP Tournament game 1", "Alpha", "Echo", 6, 5),
    ]);
    expect(out[1]!.away).toBe("WG-1");
  });
});

describe("round ordering", () => {
  it("plays play-in before series before the final tournament", () => {
    const out = deriveBracketRefs([
      g("LNP Tournament game 1", "Alpha", "Bravo", 1, 0),
      g("Play In Game", "Charlie", "Delta", 3, 2),
      g("Series Game #1", "Echo", "Foxtrot", 4, 1),
    ]);
    expect(out.map((x) => x.round)).toEqual([
      "Play In Game",
      "Series Game #1",
      "LNP Tournament game 1",
    ]);
  });

  it("orders numbered games 9 before 10", () => {
    const out = deriveBracketRefs([
      g("Game 10", "A", "B", 1, 0),
      g("Game 9", "C", "D", 1, 0),
    ]);
    expect(out.map((x) => x.round)).toEqual(["Game 9", "Game 10"]);
  });
});

describe("feeds the ported bracket engine", () => {
  // A 4-team double elimination, the shape LCYBL's "LNP Tournament game 1..6"
  // actually is: two semis, a losers game, winners final, losers final, grand
  // final. The point of the test is that the ported classifier reads the
  // derived refs and finds a real champion.
  const dbl: HistoricalGame[] = [
    g("Game 1", "Alpha", "Delta", 8, 7), // WSF
    g("Game 2", "Bravo", "Charlie", 5, 4), // WSF
    g("Game 3", "Delta", "Charlie", 14, 2), // losers
    g("Game 4", "Alpha", "Bravo", 6, 5), // winners final
    g("Game 5", "Bravo", "Delta", 8, 5), // losers final
    g("Game 6", "Alpha", "Bravo", 14, 5), // grand final
  ];

  it("derives refs the classifier can split into w / l / f", () => {
    const out = deriveBracketRefs(dbl);
    const cls = classify({ games: out });
    const kinds = new Set(Object.values(cls));
    expect(kinds.has("w")).toBe(true);
    expect(kinds.has("l")).toBe(true);
    expect(kinds.has("f")).toBe(true);
  });

  it("crowns the team that actually won", () => {
    const out = deriveBracketRefs(dbl);
    const cls = classify({ games: out });
    expect(championOutcome({ games: out }, cls).champion).toBe("Alpha");
  });

  it("produces refs that parse as advancement, not stray text", () => {
    const out = deriveBracketRefs(dbl);
    const refs = out
      .flatMap((x) => [x.away, x.home])
      .map(parseRef)
      .filter((r) => r.kind === "WG" || r.kind === "LG");
    expect(refs.length).toBeGreaterThan(4);
  });
});
