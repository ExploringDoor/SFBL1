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
  | "live"
  | "final"
  | "approved"
  // The live data, the CSV importer, the league-health check and the UI all
  // use "postponed". "ppd" / "rained_out" were declared here but written
  // nowhere, so any future `switch` on those literals would silently miss
  // every real postponed game.
  | "postponed";

export interface GameResult {
  home_team_id: string;
  away_team_id: string;
  home_score: number;
  away_score: number;
  status: GameStatus;
  date?: string; // ISO; required for streak calculation
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

export type Tiebreaker = "pct" | "rd" | "h2h";

/**
 * Head-to-head tiebreaker.
 *
 * Walks `rows` in their current order and, wherever consecutive rows are
 * `tied` (equal PCT, or equal points in points mode), re-orders that run by
 * each team's record against the OTHER tied teams only. A team that beat the
 * other ranks above it; one that lost ranks below; a pair that has not met
 * is neutral (.500) and keeps the order it arrived in — which the callers
 * make the differential order, so "head-to-head, then differential" falls out
 * of a stable sort. A three-way circle (A beat B beat C beat A) is all .500
 * and likewise falls through to differential, which is the usual rule.
 *
 * Only finished games count, and only games between members of the tied
 * group: beating a fourth team says nothing about the tie.
 */
export function applyHeadToHead(
  rows: StandingsRow[],
  games: GameResult[],
  tied: (a: StandingsRow, b: StandingsRow) => boolean,
): StandingsRow[] {
  const finished = games.filter(
    (g) => g.status === "final" || g.status === "approved",
  );
  const out: StandingsRow[] = [];
  let i = 0;
  while (i < rows.length) {
    let j = i + 1;
    while (j < rows.length && tied(rows[i]!, rows[j]!)) j++;
    const group = rows.slice(i, j);
    i = j;
    if (group.length < 2) {
      out.push(...group);
      continue;
    }
    const ids = new Set(group.map((r) => r.team_id));
    const rec = new Map<string, { w: number; t: number; gp: number }>();
    for (const id of ids) rec.set(id, { w: 0, t: 0, gp: 0 });
    for (const g of finished) {
      if (!ids.has(g.home_team_id) || !ids.has(g.away_team_id)) continue;
      const h = rec.get(g.home_team_id)!;
      const a = rec.get(g.away_team_id)!;
      h.gp += 1;
      a.gp += 1;
      if (g.home_score > g.away_score) h.w += 1;
      else if (g.away_score > g.home_score) a.w += 1;
      else {
        h.t += 1;
        a.t += 1;
      }
    }
    const pctOf = (id: string) => {
      const r = rec.get(id)!;
      return r.gp > 0 ? (r.w + 0.5 * r.t) / r.gp : 0.5;
    };
    // Array.prototype.sort is stable, so equal head-to-head keeps the
    // incoming (differential) order.
    out.push(...[...group].sort((a, b) => pctOf(b.team_id) - pctOf(a.team_id)));
  }
  return out;
}

/** PCT desc, then differential desc — the order computeStandings produces,
 *  re-applied after the extra-game rule may have changed a record. */
function sortByPctThenDiff(rows: StandingsRow[]): StandingsRow[] {
  return [...rows].sort((a, b) => b.pct - a.pct || b.rd - a.rd);
}

/**
 * Standings with the extra-game rule already applied.
 *
 * USE THIS, not computeStandings + a hand-rolled adjustment, anywhere a record
 * is shown. Seven pages compute records (standings, home, teams, one team,
 * scores, schedule, box scores) and they must agree: a coach who sees 3-0 on
 * the standings page and 3-1 on their team page will ring the league, and be
 * right to.
 *
 * Grouping happens INSIDE, so callers cannot get the baseline wrong. They only
 * have to say which division a team is in.
 *
 * `games` should be every fixture, not only the finished ones: computeStandings
 * filters to finished itself, and the schedule is what tells us who was handed
 * the extra game (see dropExtraGameLosses).
 */
export function computeStandingsWithExtraGameRule(
  games: GameResult[],
  opts: {
    /** League setting standings.drop_extra_game_loss. Off = plain standings. */
    enabled?: boolean;
    /** Division for a team. Return "" when a league has none: everyone then
     *  sits in one group, which is the right baseline for a flat league. */
    divisionOf?: (teamId: string) => string;
    /** League setting standings.tiebreaker. Only "h2h" changes anything
     *  here: rows come back PCT, then head-to-head among equal PCT, then
     *  differential. Points-mode leagues pass it to sortByPoints instead. */
    tiebreaker?: Tiebreaker;
  } = {},
): StandingsRow[] {
  const rows = computeStandings(games);
  const h2h = opts.tiebreaker === "h2h";
  if (!opts.enabled) {
    return h2h
      ? applyHeadToHead(sortByPctThenDiff(rows), games, (a, b) => a.pct === b.pct)
      : rows;
  }

  const scheduled = new Map<string, number>();
  for (const g of games) {
    for (const id of [g.home_team_id, g.away_team_id]) {
      if (id) scheduled.set(id, (scheduled.get(id) ?? 0) + 1);
    }
  }

  const divisionOf = opts.divisionOf ?? (() => "");
  const byDivision = new Map<string, StandingsRow[]>();
  for (const r of rows) {
    const d = divisionOf(r.team_id) || "";
    byDivision.set(d, [...(byDivision.get(d) ?? []), r]);
  }

  // Rebuild in the original order. Callers sort afterwards, but a silently
  // reordered list is the kind of thing that shifts a table for no reason.
  const adjusted = new Map<string, StandingsRow>();
  for (const group of byDivision.values()) {
    for (const r of dropExtraGameLosses(group, scheduled)) {
      adjusted.set(r.team_id, r);
    }
  }
  const result = rows.map((r) => adjusted.get(r.team_id) ?? r);
  return h2h
    ? applyHeadToHead(sortByPctThenDiff(result), games, (a, b) => a.pct === b.pct)
    : result;
}

/**
 * Forgive the loss in a team's extra game.
 *
 * WHY. When a division has an odd number of team-games the scheduler cannot
 * split them evenly, so exactly one team is handed one more game than the rest
 * (see buildTargetedRounds in lib/schedule-generator.ts). Mike, 2026-09-04:
 * "1 team will play 1 more than others and then we drop loss for them." Adam
 * picked the literal reading on 2026-09-04: drop one loss, keep the wins, so a
 * team that goes 3-1 over four games is shown 3-0.
 *
 * A team that wins the extra game keeps it. That is deliberate, not an
 * oversight: nobody should be punished for a fixture they did not ask for, and
 * an extra win is the upside of an extra game.
 *
 * PASS ONE DIVISION AT A TIME. The baseline is the FEWEST games in the group,
 * so handing this the whole league would measure a 12U team against a 10U team
 * three fixtures behind and forgive losses wholesale. Callers apply it after
 * grouping, never before.
 *
 * MEASURE THE SCHEDULE, NOT THE GAMES PLAYED SO FAR. This is the subtle one.
 * Judging by games PLAYED looks right in a finished season and is wrong every
 * other week of it: in April a team is routinely one game ahead of another
 * purely because the other was rained out, and this rule would cheerfully
 * strike a real loss off the leader every week until the makeup was played.
 * The extra game is a property of the SCHEDULE, known the day it is built and
 * stable all season, so pass `scheduledGames` and the baseline comes from
 * there. The played-games fallback exists only for callers that genuinely
 * have no schedule to hand, and it carries that flaw.
 *
 * RUNS ARE LEFT ALONE. Removing the runs would mean picking WHICH loss to
 * strike, and the row does not carry its games. Leaving them counts the extra
 * game against a team's run differential while not counting it against their
 * record, which errs against the team being forgiven. That is the safe
 * direction for a tiebreaker.
 *
 * Returns a new array. Does not mutate.
 */
export function dropExtraGameLosses(
  rows: StandingsRow[],
  /** Fixtures each team has ON THE SCHEDULE, played or not. Strongly preferred
   *  over the games-played fallback; see the note above. */
  scheduledGames?: Map<string, number> | Record<string, number>,
): StandingsRow[] {
  const scheduledOf = (id: string): number | undefined => {
    if (!scheduledGames) return undefined;
    const n =
      scheduledGames instanceof Map ? scheduledGames.get(id) : scheduledGames[id];
    return typeof n === "number" && n > 0 ? n : undefined;
  };
  // Only usable if EVERY team in the group has a schedule. A partial map would
  // silently mix the two baselines and forgive the wrong teams.
  const useSchedule =
    !!scheduledGames && rows.every((r) => scheduledOf(r.team_id) !== undefined);
  const countFor = (r: StandingsRow) =>
    useSchedule ? scheduledOf(r.team_id)! : r.gp;

  const played = rows.filter((r) => r.gp > 0);
  // Nothing to compare against, so nothing to forgive.
  if (played.length < 2) return rows.map((r) => ({ ...r }));

  // A team that has not played yet cannot set the baseline in played mode; in
  // schedule mode every team counts, which is the point of using the schedule.
  const basis = useSchedule ? rows : played;
  const minGp = Math.min(...basis.map(countFor));
  const out = rows.map((r) => {
    const extra = countFor(r) - minGp;
    // Only a team ABOVE the baseline, and only as far as it actually lost.
    const drop = Math.max(0, Math.min(extra, r.l));
    if (drop === 0) return { ...r };
    const gp = r.gp - drop;
    const l = r.l - drop;
    return {
      ...r,
      gp,
      l,
      pct: gp > 0 ? (r.w + 0.5 * r.t) / gp : 0,
    };
  });

  // Games behind is measured off W-L, so it has to be redone against the
  // adjusted records rather than the ones the games produced.
  const winDiffs = out.map((r) => r.w - r.l);
  const best = winDiffs.length ? Math.max(...winDiffs) : 0;
  for (const r of out) r.gb = (best - (r.w - r.l)) / 2;
  return out;
}

// Sort an existing standings list by points desc with the given
// tiebreaker. Use this when the league config has `scoring: 'points'`.
// Returns a new array — does not mutate. Doesn't recompute GB (which is
// W-L-based and stays meaningful even in points mode for "games behind
// first place").
export function sortByPoints(
  rows: StandingsRow[],
  scheme: PointsScheme,
  tiebreaker: Tiebreaker = "rd",
  /** Needed only for "h2h": the games the tied teams played against each
   *  other. Without it "h2h" behaves as "rd". */
  games?: GameResult[],
): StandingsRow[] {
  const annotated = rows.map((r) => ({ row: r, points: computePoints(r, scheme) }));
  annotated.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (tiebreaker === "pct") return b.row.pct - a.row.pct;
    return b.row.rd - a.row.rd;
  });
  const sorted = annotated.map((a) => a.row);
  if (tiebreaker !== "h2h" || !games) return sorted;
  const pts = new Map(annotated.map((a) => [a.row.team_id, a.points]));
  return applyHeadToHead(
    sorted,
    games,
    (a, b) => pts.get(a.team_id) === pts.get(b.team_id),
  );
}

// Compute standings from a list of game results. Filters to finished games
// (final or approved). Postponed/rained-out games never count. Also computes
// each team's current streak ("W3"/"L1"/"T1") if dates are available on
// the games — otherwise leaves streak undefined.
export function computeStandings(games: GameResult[]): StandingsRow[] {
  const finished = games.filter(
    (g) => g.status === "final" || g.status === "approved",
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

/**
 * Give every team a row, whether or not it has played.
 *
 * computeStandings() only counts FINISHED games, so before opening day it
 * returns nothing at all and a league's standings block has no rows to draw.
 * Island opened its schedule with 92 games scheduled and none played, so the
 * homepage showed "Standings will appear here after the first game is final"
 * beside a full slate of fixtures, and Mike asked to see the table at zeros
 * instead (2026-09-08).
 *
 * Teams that already have a row keep it untouched, so this changes nothing
 * once results start arriving. Rows added here are genuinely empty: no
 * streak, no recent form, rather than a fabricated one.
 */
export function seedStandingsWithAllTeams(
  rows: StandingsRow[],
  teamIds: string[],
): StandingsRow[] {
  const have = new Set(rows.map((r) => r.team_id));
  const missing = teamIds
    .filter((id) => id && !have.has(id))
    .map((team_id) => ({
      team_id,
      gp: 0,
      w: 0,
      l: 0,
      t: 0,
      rs: 0,
      ra: 0,
      rd: 0,
      pct: 0,
      gb: 0,
    }));
  return [...rows, ...missing];
}
