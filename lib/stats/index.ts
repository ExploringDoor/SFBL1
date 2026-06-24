// Stat math entry point. The only function here is `recalcLeague`,
// which:
//
//   1. Reads /leagues/{id} → discovers sport
//   2. Reads all box scores under that league
//   3. Aggregates batting (and pitching for baseball) using the
//      sport-specific aggregators
//   4. Writes per-player stats to /leagues/{id}/players/{pid}.stats
//      with the dirty-check optimization (skip no-op writes)
//
// Admin SDK only — bypasses rules by design. Called from Cloud
// Functions or `npm run grant-claim`-style scripts.
//
// Wiring (Phase 3 step 6) will expose this via a callable Cloud
// Function or an admin-page button.

import type { Firestore } from "firebase-admin/firestore";

import {
  aggregateBatting as aggregateBaseballBatting,
  aggregatePitching,
  batterStatsAreEqual,
  pitcherStatsAreEqual,
  type BaseballBattingLine,
  type BaseballBatterStats,
  type BaseballPitchingLine,
  type BaseballPitcherStats,
} from "./baseball";

import {
  aggregateBatting as aggregateSoftballBatting,
  statsAreEqual as softballStatsAreEqual,
  type SoftballBattingLine,
  type SoftballPlayerStats,
} from "./softball";

import { battingLineError } from "./validate";

export type Sport = "softball" | "baseball";

export interface RecalcResult {
  league_id: string;
  sport: Sport;
  box_scores_read: number;
  players_aggregated: number;
  players_written: number; // after dirty-check
  pitchers_written: number;
  duration_ms: number;
  /** Batting lines skipped because H < 2B+3B+HR. Such a line makes
   *  sluggingPct throw inside aggregateBatting, which would otherwise
   *  abort the whole recalc (HTTP 500) and write NObody's stats. We
   *  skip just the offending line and surface it here with the exact
   *  player + game so the admin can fix that one box score. Empty on
   *  clean data. */
  flagged_lines: Array<{ player_id: string; game_id: string; reason: string }>;
}

export async function recalcLeague(
  db: Firestore,
  leagueId: string,
): Promise<RecalcResult> {
  const startedAt = Date.now();

  // 1. Read league config to discover sport.
  const leagueRef = db.doc(`leagues/${leagueId}`);
  const leagueSnap = await leagueRef.get();
  if (!leagueSnap.exists) {
    throw new Error(`recalcLeague: league "${leagueId}" not found.`);
  }
  const sport = leagueSnap.get("sport") as Sport | undefined;
  if (sport !== "softball" && sport !== "baseball") {
    throw new Error(
      `recalcLeague: league "${leagueId}" has unknown sport "${sport}". ` +
        `Expected "softball" or "baseball".`,
    );
  }

  // 2. Read all box scores. Filter to finalized ones — drafts shouldn't
  //    contribute to season stats.
  const boxScoresSnap = await db
    .collection(`leagues/${leagueId}/box_scores`)
    .get();
  const boxScores = boxScoresSnap.docs.filter((d) => {
    const status = d.get("status");
    return status === "final" || status === "approved";
  });

  // 2b. Determine the "current" season for this league. Box scores
  //     migrated from LBDC's source carry a season_id slug (see
  //     scripts/transform-lbdc.ts) — we pick the season_id from the
  //     newest dated box. For SFBL (no season_id yet) currentSeasonId
  //     stays null, in which case currentSeasonBoxes === all boxes —
  //     stats and career_stats end up identical and the page reads
  //     stay backwards-compatible.
  let currentSeasonId: string | null = null;
  let latestDate = "";
  for (const d of boxScores) {
    const data = d.data();
    const seasonId =
      typeof data.season_id === "string" ? data.season_id : null;
    const date = String(data.date ?? "");
    if (!seasonId || !date) continue;
    if (date > latestDate) {
      latestDate = date;
      currentSeasonId = seasonId;
    }
  }
  const currentSeasonBoxes = currentSeasonId
    ? boxScores.filter((d) => d.data().season_id === currentSeasonId)
    : boxScores;

  // 3. Flatten lineups into per-game lines. We collect two parallel
  //    sets: current-season (writes to player.stats) and all-time
  //    (writes to player.career_stats). The all-time bucket is the
  //    superset of current-season.
  const currentBatting: Array<SoftballBattingLine | BaseballBattingLine> = [];
  const careerBatting: Array<SoftballBattingLine | BaseballBattingLine> = [];
  const currentPitching: BaseballPitchingLine[] = [];
  const careerPitching: BaseballPitchingLine[] = [];
  // Inconsistent lines we refused to aggregate (see flagged_lines on
  // RecalcResult). Write paths validate up front, but data already in
  // Firestore — or written before this guard existed — can still be
  // bad, so recalc defends itself here too.
  const flaggedLines: RecalcResult["flagged_lines"] = [];

  for (const doc of boxScores) {
    const data = doc.data();
    const isCurrent =
      currentSeasonId === null || data.season_id === currentSeasonId;
    const away = (data.away_lineup ?? []) as Array<Record<string, unknown>>;
    const home = (data.home_lineup ?? []) as Array<Record<string, unknown>>;
    for (const line of [...away, ...home]) {
      const bl = toBattingLine(line, sport);
      // Guard the H >= 2B+3B+HR invariant. Skipping every line that
      // violates it keeps the per-player AGGREGATE safe too: if every
      // retained line has H_i >= (2B+3B+HR)_i, then summed H covers
      // summed extra-base hits, so sluggingPct never goes negative.
      // One bad line is dropped + flagged (with player + game) instead
      // of taking down the entire league's recalc.
      const reason = battingLineError(bl);
      if (reason) {
        flaggedLines.push({
          player_id: bl.player_id || "(unknown)",
          game_id: doc.id,
          reason,
        });
        continue;
      }
      careerBatting.push(bl);
      if (isCurrent) currentBatting.push(bl);
    }
    if (sport === "baseball") {
      const aw = (data.away_pitchers ?? []) as Array<Record<string, unknown>>;
      const hp = (data.home_pitchers ?? []) as Array<Record<string, unknown>>;
      for (const line of [...aw, ...hp]) {
        const pl = toPitchingLine(line);
        careerPitching.push(pl);
        if (isCurrent) currentPitching.push(pl);
      }
    }
  }

  // 4. Run sport-specific aggregators on BOTH buckets.
  function aggBatting(
    lines: Array<SoftballBattingLine | BaseballBattingLine>,
  ): SoftballPlayerStats[] | BaseballBatterStats[] {
    if (sport === "softball") {
      return aggregateSoftballBatting(lines as SoftballBattingLine[]);
    }
    if (sport === "baseball") {
      return aggregateBaseballBatting(lines as BaseballBattingLine[]);
    }
    // Sport union is exhausted above; this throw exists only so TS
    // can prove the function returns a value on every branch.
    throw new Error(`unreachable sport variant: ${String(sport)}`);
  }
  const currentBatterStats = aggBatting(currentBatting);
  const careerBatterStats = aggBatting(careerBatting);
  const currentPitcherStats =
    sport === "baseball" ? aggregatePitching(currentPitching) : [];
  const careerPitcherStats =
    sport === "baseball" ? aggregatePitching(careerPitching) : [];

  // 5. Write stats. player.stats / player.pitching = current-season;
  //    player.career_stats / player.career_pitching = all-time. We
  //    pass both into writeStats which dirty-checks each independently.
  const writes = await writeStats(
    db,
    leagueId,
    sport,
    currentBatterStats,
    careerBatterStats,
    currentPitcherStats,
    careerPitcherStats,
  );

  if (flaggedLines.length > 0) {
    console.warn(
      `[recalcLeague] ${leagueId}: skipped ${flaggedLines.length} ` +
        `inconsistent batting line(s) (H < 2B+3B+HR) — ` +
        flaggedLines
          .map((f) => `player ${f.player_id} in game ${f.game_id}`)
          .join("; ") +
        `. Fix those box scores and re-run recalc.`,
    );
  }

  return {
    league_id: leagueId,
    sport,
    box_scores_read: boxScores.length,
    players_aggregated: careerBatterStats.length,
    players_written: writes.batter_writes,
    pitchers_written: writes.pitcher_writes,
    duration_ms: Date.now() - startedAt,
    flagged_lines: flaggedLines,
  };
}

// -----------------------------------------------------------------------------

function toBattingLine(
  raw: Record<string, unknown>,
  sport: Sport,
): SoftballBattingLine | BaseballBattingLine {
  const base = {
    player_id: String(raw.player_id ?? ""),
    ab: num(raw.ab),
    r: num(raw.r),
    h: num(raw.h),
    doubles: num(raw.doubles ?? raw.d ?? 0),
    triples: num(raw.triples ?? raw.t ?? 0),
    hr: num(raw.hr),
    rbi: num(raw.rbi),
    bb: num(raw.bb),
    so: num(raw.so ?? raw.k ?? 0),
    sb: raw.sb !== undefined ? num(raw.sb) : undefined,
  };
  if (sport === "softball") {
    return { ...base, pb: raw.pb !== undefined ? num(raw.pb) : undefined };
  } else if (sport === "baseball") {
    return base;
  }
  assertNever(sport);
}

function toPitchingLine(raw: Record<string, unknown>): BaseballPitchingLine {
  return {
    player_id: String(raw.player_id ?? ""),
    ip_outs: num(raw.ip_outs),
    h: num(raw.h),
    r: num(raw.r),
    er: num(raw.er),
    bb: num(raw.bb),
    so: num(raw.so ?? raw.k ?? 0),
    hr: num(raw.hr),
    decision: raw.decision as "W" | "L" | "S" | undefined,
  };
}

function num(x: unknown): number {
  if (typeof x === "number") return x;
  if (typeof x === "string" && x.trim() !== "" && !Number.isNaN(Number(x))) {
    return Number(x);
  }
  return 0;
}

// -----------------------------------------------------------------------------

async function writeStats(
  db: Firestore,
  leagueId: string,
  sport: Sport,
  currentBatters: SoftballPlayerStats[] | BaseballBatterStats[],
  careerBatters: SoftballPlayerStats[] | BaseballBatterStats[],
  currentPitchers: BaseballPitcherStats[],
  careerPitchers: BaseballPitcherStats[],
): Promise<{ batter_writes: number; pitcher_writes: number }> {
  // Index by player_id so we can pair current with career.
  const currentBattersById = new Map<
    string,
    SoftballPlayerStats | BaseballBatterStats
  >();
  for (const b of currentBatters)
    if (b.player_id) currentBattersById.set(b.player_id, b);
  const careerBattersById = new Map<
    string,
    SoftballPlayerStats | BaseballBatterStats
  >();
  for (const b of careerBatters)
    if (b.player_id) careerBattersById.set(b.player_id, b);
  const currentPitchersById = new Map<string, BaseballPitcherStats>();
  for (const p of currentPitchers)
    if (p.player_id) currentPitchersById.set(p.player_id, p);
  const careerPitchersById = new Map<string, BaseballPitcherStats>();
  for (const p of careerPitchers)
    if (p.player_id) careerPitchersById.set(p.player_id, p);

  // Touch every player that appears in any of the four buckets.
  const allPlayerIds = new Set<string>([
    ...currentBattersById.keys(),
    ...careerBattersById.keys(),
    ...currentPitchersById.keys(),
    ...careerPitchersById.keys(),
  ]);

  const playerRefs = [...allPlayerIds].map((pid) =>
    db.doc(`leagues/${leagueId}/players/${pid}`),
  );
  const existingDocs = playerRefs.length ? await db.getAll(...playerRefs) : [];
  const existingByPath = new Map(
    existingDocs.map((d) => [d.ref.path, d.data() ?? {}]),
  );

  // Firestore caps a single batch at 500 operations. With split
  // current/career writes per player, the LBDC migration touches
  // 1100+ players → easily blows the limit if we use one batch.
  // Stash the per-player updates and flush in chunks of 400.
  const pendingWrites: Array<{
    ref: FirebaseFirestore.DocumentReference;
    data: Record<string, unknown>;
  }> = [];
  let batterWrites = 0;
  let pitcherWrites = 0;

  // Empty-stat sentinels — for players who appeared career-wide but
  // not this season (or vice-versa) we still write a zeroed bucket
  // so the page never reads stale career into a "current season"
  // slot. emptyBatter/emptyPitcher live in the sport modules.
  function zeroBatter(player_id: string): SoftballPlayerStats | BaseballBatterStats {
    if (sport === "baseball") {
      return {
        player_id, gp: 0, ab: 0, r: 0, h: 0, doubles: 0, triples: 0,
        hr: 0, rbi: 0, bb: 0, so: 0, sb: 0,
        avg: 0, slg: 0, obp: 0, ops: 0,
      } as BaseballBatterStats;
    }
    // Softball
    return {
      player_id, gp: 0, ab: 0, r: 0, h: 0, doubles: 0, triples: 0,
      hr: 0, rbi: 0, bb: 0, so: 0,
    } as unknown as SoftballPlayerStats;
  }
  function zeroPitcher(player_id: string): BaseballPitcherStats {
    return {
      player_id, app: 0, w: 0, l: 0, sv: 0,
      ip_outs: 0, h: 0, r: 0, er: 0, bb: 0, so: 0, hr: 0,
      era: 0, whip: 0,
    };
  }

  for (const pid of allPlayerIds) {
    const ref = db.doc(`leagues/${leagueId}/players/${pid}`);
    const prev = existingByPath.get(ref.path);
    const update: Record<string, unknown> = {};

    // Current-season batter (player.stats)
    const curBat = currentBattersById.get(pid) ?? zeroBatter(pid);
    if (
      !prev?.stats ||
      !areBatterStatsEqual(prev.stats, curBat, sport)
    ) {
      update.stats = curBat;
    }
    // Career batter (player.career_stats)
    const carBat = careerBattersById.get(pid) ?? zeroBatter(pid);
    if (
      !prev?.career_stats ||
      !areBatterStatsEqual(prev.career_stats, carBat, sport)
    ) {
      update.career_stats = carBat;
    }

    // Pitching (baseball only — softball aggregators don't emit it)
    if (sport === "baseball") {
      const curPit = currentPitchersById.get(pid) ?? zeroPitcher(pid);
      if (
        !prev?.pitching ||
        !pitcherStatsAreEqual(
          prev.pitching as BaseballPitcherStats,
          curPit,
        )
      ) {
        update.pitching = curPit;
      }
      const carPit = careerPitchersById.get(pid) ?? zeroPitcher(pid);
      if (
        !prev?.career_pitching ||
        !pitcherStatsAreEqual(
          prev.career_pitching as BaseballPitcherStats,
          carPit,
        )
      ) {
        update.career_pitching = carPit;
      }
    }

    if (Object.keys(update).length === 0) continue;
    pendingWrites.push({ ref, data: update });
    if ("stats" in update || "career_stats" in update) batterWrites += 1;
    if ("pitching" in update || "career_pitching" in update)
      pitcherWrites += 1;
  }

  // Flush in chunks of 400 (under Firestore's 500-op batch limit).
  for (let i = 0; i < pendingWrites.length; i += 400) {
    const chunk = pendingWrites.slice(i, i + 400);
    const b = db.batch();
    for (const { ref, data } of chunk) b.set(ref, data, { merge: true });
    await b.commit();
  }
  return { batter_writes: batterWrites, pitcher_writes: pitcherWrites };
}

function areBatterStatsEqual(
  a: unknown,
  b: SoftballPlayerStats | BaseballBatterStats,
  sport: Sport,
): boolean {
  if (sport === "softball") {
    return softballStatsAreEqual(a as SoftballPlayerStats, b as SoftballPlayerStats);
  } else if (sport === "baseball") {
    return batterStatsAreEqual(a as BaseballBatterStats, b as BaseballBatterStats);
  }
  assertNever(sport);
}

// Exhaustiveness guard. If `Sport` ever grows a third member,
// every if/else-if chain that calls this fails to typecheck —
// catches sport-variant additions at build time.
function assertNever(x: never): never {
  throw new Error(`Unhandled sport variant: ${String(x)}`);
}
