// Turn a HISTORICAL bracket — concrete team names, grouped by printed round —
// into the WG-n / LG-n advancement shape that lib/sts-bracket + the bracket
// renderer expect.
//
// Why this is a conversion and not a guess:
//
//   The archive prints who played whom and what the score was. It does NOT
//   print "the winner of game 3 plays here". But that edge is recoverable
//   without inventing anything: if a team WON game 3 and then appears in a
//   later game, the later game's slot IS the winner of game 3. Likewise a team
//   that LOST and reappears in a losers-bracket game is LG-n. Anything that
//   cannot be traced to an earlier result keeps its literal team name, which is
//   exactly right for a team entering the bracket for the first time.
//
// Best-of-N series are collapsed to ONE bracket node. LCYBL plays a best-of-3
// quarter-final as "Series Game #1/#2/#3", three rows for a single matchup;
// drawing three cards would make one round look like three and break the tree.
// The node carries the SERIES tally (2-1) as its score, with the individual
// games kept for the card.

export interface HistoricalGame {
  round: string;
  sideA: string;
  sideB: string;
  scoreA: number | null;
  scoreB: number | null;
}

export interface DerivedGame {
  g: number;
  away: string;
  home: string;
  away_score: number | null;
  home_score: number | null;
  done: boolean;
  /** Printed round label, e.g. "Series Game #1" or "LNP Tournament game 4". */
  round: string;
  /** Individual results when this node is a collapsed series. */
  seriesGames?: { a: number | null; b: number | null }[];
}

const norm = (s: string) =>
  String(s ?? "")
    .replace(/^#\s*[A-Za-z]?\d+\s*/, "") // strip a printed seed: "#D1 Hempfield" -> "Hempfield"
    .trim()
    .toLowerCase();

/** Round families, in the order a tournament is actually played. Used only to
 *  order nodes; the labels themselves are preserved verbatim on the card. */
function roundRank(label: string): number {
  const l = (label || "").toLowerCase();
  if (l.includes("play in") || l.includes("play-in")) return 0;
  if (l.includes("series")) return 1;
  if (l.includes("lnp")) return 3;
  return 2;
}

function roundNum(label: string): number {
  const m = /(\d+)/.exec(label || "");
  return m ? Number(m[1]) : 0;
}

/** Is this round one whose repeated matchups form a best-of-N series? */
function isSeriesRound(label: string): boolean {
  return /series/i.test(label || "");
}

/**
 * Convert printed rounds into ref-linked bracket games.
 *
 * `games` must already be in printed order within each round; the round order
 * itself is derived (play-in, then series, then everything else, then the
 * final tournament).
 */
export function deriveBracketRefs(games: HistoricalGame[]): DerivedGame[] {
  const ordered = [...games].sort(
    (a, b) =>
      roundRank(a.round) - roundRank(b.round) ||
      roundNum(a.round) - roundNum(b.round),
  );

  // ── 1. collapse best-of-N series into one node each ──────────────
  const nodes: {
    round: string;
    a: string;
    b: string;
    results: { a: number | null; b: number | null }[];
  }[] = [];
  const seriesIndex = new Map<string, number>();

  for (const g of ordered) {
    const key = isSeriesRound(g.round)
      ? [norm(g.sideA), norm(g.sideB)].sort().join("|")
      : null;
    if (key && seriesIndex.has(key)) {
      const n = nodes[seriesIndex.get(key)!]!;
      // Keep each result oriented to the NODE's sides, not the row's, or a
      // game with the teams printed in the other order inverts the tally.
      const flipped = norm(g.sideA) !== norm(n.a);
      n.results.push(
        flipped ? { a: g.scoreB, b: g.scoreA } : { a: g.scoreA, b: g.scoreB },
      );
      continue;
    }
    nodes.push({
      round: g.round,
      a: g.sideA,
      b: g.sideB,
      results: [{ a: g.scoreA, b: g.scoreB }],
    });
    if (key) seriesIndex.set(key, nodes.length - 1);
  }

  // ── 2. number them, and work out each node's winner / loser ──────
  const out: DerivedGame[] = nodes.map((n, i) => {
    let aw = 0;
    let bw = 0;
    let decided = 0;
    for (const r of n.results) {
      if (r.a == null || r.b == null) continue;
      decided += 1;
      if (r.a > r.b) aw += 1;
      else if (r.b > r.a) bw += 1;
    }
    const series = n.results.length > 1;
    return {
      g: i + 1,
      away: n.a,
      home: n.b,
      // A collapsed series shows its tally; a single game shows its score.
      away_score: decided === 0 ? null : series ? aw : n.results[0]!.a,
      home_score: decided === 0 ? null : series ? bw : n.results[0]!.b,
      done: decided > 0,
      round: n.round,
      ...(series ? { seriesGames: n.results } : {}),
    };
  });

  // Winner/loser must be read from the ORIGINAL team names. The loop below
  // rewrites sides in place, so by the time game 3 is processed, game 2's side
  // may already say "WG-1" — matching against that finds nothing and the chain
  // silently breaks after one round.
  const orig = nodes.map((n) => ({ a: n.a, b: n.b }));

  const winnerOf = (d: DerivedGame): string | null => {
    if (!d.done || d.away_score == null || d.home_score == null) return null;
    const o = orig[d.g - 1]!;
    if (d.away_score > d.home_score) return o.a;
    if (d.home_score > d.away_score) return o.b;
    return null;
  };
  const loserOf = (d: DerivedGame): string | null => {
    if (!d.done || d.away_score == null || d.home_score == null) return null;
    const o = orig[d.g - 1]!;
    if (d.away_score > d.home_score) return o.b;
    if (d.home_score > d.away_score) return o.a;
    return null;
  };

  // ── 3. replace a side with the earlier game it advanced from ─────
  // Each earlier result may be consumed ONCE. Without that, a team that wins
  // twice has both later slots pointing at the same first game, which draws
  // two connectors out of one card and a round that never happened.
  const usedWin = new Set<number>();
  const usedLoss = new Set<number>();

  for (let i = 0; i < out.length; i++) {
    const cur = out[i]!;
    for (const side of ["away", "home"] as const) {
      const nameNorm = norm(cur[side]);
      let ref: string | null = null;
      // Nearest earlier game first: a team's most recent result is what it
      // advanced from.
      for (let j = i - 1; j >= 0; j--) {
        const prev = out[j]!;
        if (!usedWin.has(prev.g) && norm(winnerOf(prev) ?? "") === nameNorm) {
          ref = `WG-${prev.g}`;
          usedWin.add(prev.g);
          break;
        }
        if (!usedLoss.has(prev.g) && norm(loserOf(prev) ?? "") === nameNorm) {
          ref = `LG-${prev.g}`;
          usedLoss.add(prev.g);
          break;
        }
      }
      if (ref) cur[side] = ref;
    }
  }

  return out;
}
