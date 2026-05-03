// Stat math shared between softball and baseball.
//
// Two responsibilities:
//   1. Pure batting-derived formulas (BA / SLG / OBP / OPS).
//   2. Standings — W/L/T from game results, PCT, GB, run differential.
//
// All functions are pure (no I/O, no Firestore). Sport-specific aggregators
// live in softball.ts and baseball.ts and call into these.

// =============================================================================
// Batting derived stats
// =============================================================================

// AVG = H / AB. Returns 0 when AB is 0 (matches DVSL/baseball convention).
export function battingAverage(h: number, ab: number): number {
  if (ab === 0) return 0;
  return h / ab;
}

// SLG = total bases / AB
// where total bases = singles + 2*doubles + 3*triples + 4*HR
// and singles = H - 2B - 3B - HR
export function sluggingPct(
  h: number,
  doubles: number,
  triples: number,
  hr: number,
  ab: number,
): number {
  if (ab === 0) return 0;
  const singles = h - doubles - triples - hr;
  if (singles < 0) {
    throw new Error(
      `sluggingPct: H (${h}) is less than 2B+3B+HR (${doubles + triples + hr}). ` +
        `Box score data is inconsistent.`,
    );
  }
  return (singles + 2 * doubles + 3 * triples + 4 * hr) / ab;
}

// OBP = (H + BB) / (AB + BB)
// Simplified: no HBP, SF, or SH tracked yet. Add when DVSL/LB schemas catch up.
export function onBasePct(h: number, bb: number, ab: number): number {
  const denom = ab + bb;
  if (denom === 0) return 0;
  return (h + bb) / denom;
}

export function ops(obp: number, slg: number): number {
  return obp + slg;
}

// =============================================================================
// Standings
// =============================================================================

export type GameStatus =
  | "draft"
  | "scheduled"
  | "final"
  | "approved"
  | "ppd"
  | "rained_out";

export interface GameResult {
  home_team_id: string;
  away_team_id: string;
  home_score: number;
  away_score: number;
  status: GameStatus;
}

export interface StandingsRow {
  team_id: string;
  gp: number; // games played
  w: number;
  l: number;
  t: number;
  rs: number; // runs scored
  ra: number; // runs allowed
  rd: number; // run differential
  pct: number;
  gb: number;
}

export interface PointsScheme {
  win: number;
  tie: number;
  loss: number;
}

// Pure function. Apply a points scheme to a row's W/L/T.
// e.g. DVSL softball: {win:3, tie:2, loss:1} → 3W + 2T + L points.
export function computePoints(row: StandingsRow, scheme: PointsScheme): number {
  return row.w * scheme.win + row.t * scheme.tie + row.l * scheme.loss;
}

export type Tiebreaker = "pct" | "rd";

// Sort an existing standings list by points desc with the given
// tiebreaker. Use this when the league config has `scoring: 'points'`.
// Returns a new array — does not mutate. Doesn't recompute GB (which is
// W-L-based and stays meaningful even in points mode for "games behind
// first place").
export function sortByPoints(
  rows: StandingsRow[],
  scheme: PointsScheme,
  tiebreaker: Tiebreaker = "rd",
): StandingsRow[] {
  const annotated = rows.map((r) => ({ row: r, points: computePoints(r, scheme) }));
  annotated.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (tiebreaker === "pct") return b.row.pct - a.row.pct;
    return b.row.rd - a.row.rd;
  });
  return annotated.map((a) => a.row);
}

// Compute standings from a list of game results. Filters to finished games
// (final or approved). Postponed/rained-out games never count.
export function computeStandings(games: GameResult[]): StandingsRow[] {
  const finished = games.filter(
    (g) => g.status === "final" || g.status === "approved",
  );

  const rows = new Map<string, StandingsRow>();
  function row(teamId: string): StandingsRow {
    let r = rows.get(teamId);
    if (!r) {
      r = {
        team_id: teamId,
        gp: 0, w: 0, l: 0, t: 0,
        rs: 0, ra: 0, rd: 0,
        pct: 0, gb: 0,
      };
      rows.set(teamId, r);
    }
    return r;
  }

  for (const g of finished) {
    const home = row(g.home_team_id);
    const away = row(g.away_team_id);

    home.gp += 1;
    away.gp += 1;
    home.rs += g.home_score;
    home.ra += g.away_score;
    away.rs += g.away_score;
    away.ra += g.home_score;

    if (g.home_score > g.away_score) {
      home.w += 1;
      away.l += 1;
    } else if (g.away_score > g.home_score) {
      away.w += 1;
      home.l += 1;
    } else {
      home.t += 1;
      away.t += 1;
    }
  }

  // Compute PCT, RD.
  for (const r of rows.values()) {
    r.rd = r.rs - r.ra;
    // PCT = (W + 0.5*T) / GP. Standard baseball / DVSL convention.
    r.pct = r.gp > 0 ? (r.w + 0.5 * r.t) / r.gp : 0;
  }

  // GB = (best team's W-L diff - this team's W-L diff) / 2.
  const winDiffs = [...rows.values()].map((r) => r.w - r.l);
  const bestWinDiff = winDiffs.length ? Math.max(...winDiffs) : 0;
  for (const r of rows.values()) {
    r.gb = (bestWinDiff - (r.w - r.l)) / 2;
  }

  // Sort: PCT desc, then run-differential desc.
  // (Head-to-head tiebreaker is v1, not MVP.)
  return [...rows.values()].sort((a, b) => {
    if (b.pct !== a.pct) return b.pct - a.pct;
    return b.rd - a.rd;
  });
}
