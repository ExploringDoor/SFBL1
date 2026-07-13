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
  let singles = h - doubles - triples - hr;
  if (singles < 0) {
    // Inconsistent line (H < 2B+3B+HR) — bad data, e.g. from a migration
    // import or a direct Web-SDK write that bypassed the editor's guard.
    // Do NOT throw: a single bad box-score line used to abort the entire
    // league stats recalc with a 500 and leave EVERY player's stats
    // frozen (audit H6). Clamp the bad line and keep going so the rest of
    // the league still recalculates.
    console.warn(
      `sluggingPct: H (${h}) < 2B+3B+HR (${doubles + triples + hr}); ` +
        `clamping singles to 0 (inconsistent box-score line).`,
    );
    singles = 0;
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
  | "live"
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
  date?: string; // ISO; required for streak calculation
  /** Playoff games are NOT regular-season results — computeStandings
   *  excludes them so a bracket result never inflates a team's W-L
   *  record (Nelson request, 2026-07). */
  is_playoff?: boolean;
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
  streak?: string; // "W3", "L2", "T1" — undefined if no games played
  /** Last-5-game outcomes in chronological order, oldest first.
   *  Used to render a sparkline-style trend chart on the standings
   *  page. Empty when no games played. */
  recent?: ("W" | "L" | "T")[];
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
// (final or approved). Postponed/rained-out games never count. Also computes
// each team's current streak ("W3"/"L1"/"T1") if dates are available on
// the games — otherwise leaves streak undefined.
export function computeStandings(games: GameResult[]): StandingsRow[] {
  const finished = games.filter(
    (g) =>
      (g.status === "final" || g.status === "approved") &&
      // Playoff games never count toward the regular-season standings.
      !g.is_playoff,
  );

  // Sort by date for streak calc; preserves stable order otherwise.
  const sortedFinished = [...finished].sort((a, b) =>
    String(a.date ?? "").localeCompare(String(b.date ?? "")),
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

  // Streaks: walk games in date order, append outcome to per-team list,
  // then collapse the trailing run. Date order isn't guaranteed if games
  // lack dates, but we tried.
  const outcomes = new Map<string, string[]>();
  for (const g of sortedFinished) {
    const homeOutcome =
      g.home_score > g.away_score ? "W" : g.away_score > g.home_score ? "L" : "T";
    const awayOutcome =
      g.away_score > g.home_score ? "W" : g.home_score > g.away_score ? "L" : "T";
    if (!outcomes.has(g.home_team_id)) outcomes.set(g.home_team_id, []);
    if (!outcomes.has(g.away_team_id)) outcomes.set(g.away_team_id, []);
    outcomes.get(g.home_team_id)!.push(homeOutcome);
    outcomes.get(g.away_team_id)!.push(awayOutcome);
  }
  for (const [teamId, list] of outcomes) {
    if (list.length === 0) continue;
    const last = list[list.length - 1]!;
    let count = 0;
    for (let i = list.length - 1; i >= 0 && list[i] === last; i--) count++;
    const r = rows.get(teamId);
    if (r) {
      r.streak = `${last}${count}`;
      // Last 5 outcomes for the L5 sparkline. Cap at 5 — older
      // games aren't useful for a "recent form" indicator.
      r.recent = list.slice(-5) as ("W" | "L" | "T")[];
    }
  }

  // Sort: PCT desc, then run-differential desc.
  // (Head-to-head tiebreaker is v1, not MVP.)
  return [...rows.values()].sort((a, b) => {
    if (b.pct !== a.pct) return b.pct - a.pct;
    return b.rd - a.rd;
  });
}
