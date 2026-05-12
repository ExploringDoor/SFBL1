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

export type Sport = "softball" | "baseball";

export interface RecalcResult {
  league_id: string;
  sport: Sport;
  box_scores_read: number;
  players_aggregated: number;
  players_written: number; // after dirty-check
  pitchers_written: number;
  duration_ms: number;
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

  // 3. Flatten lineups across all box scores into per-game lines.
  const battingLines: Array<SoftballBattingLine | BaseballBattingLine> = [];
  const pitchingLines: BaseballPitchingLine[] = [];

  for (const doc of boxScores) {
    const data = doc.data();
    const away = (data.away_lineup ?? []) as Array<Record<string, unknown>>;
    const home = (data.home_lineup ?? []) as Array<Record<string, unknown>>;
    for (const line of [...away, ...home]) {
      battingLines.push(toBattingLine(line, sport));
    }
    if (sport === "baseball") {
      const aw = (data.away_pitchers ?? []) as Array<Record<string, unknown>>;
      const hp = (data.home_pitchers ?? []) as Array<Record<string, unknown>>;
      for (const line of [...aw, ...hp]) {
        pitchingLines.push(toPitchingLine(line));
      }
    }
  }

  // 4. Run sport-specific aggregators.
  let batterStats: SoftballPlayerStats[] | BaseballBatterStats[];
  let pitcherStats: BaseballPitcherStats[] = [];

  // Closes audit M1. Replace `else` with `else if/else assertNever`
  // so adding a third sport to the Sport union (PLAN §3 calls for
  // variants) becomes a typecheck failure here instead of silently
  // running baseball logic.
  if (sport === "softball") {
    batterStats = aggregateSoftballBatting(battingLines as SoftballBattingLine[]);
  } else if (sport === "baseball") {
    batterStats = aggregateBaseballBatting(battingLines as BaseballBattingLine[]);
    pitcherStats = aggregatePitching(pitchingLines);
  } else {
    assertNever(sport);
  }

  // 5. Write stats to /leagues/{id}/players/{pid}.stats with dirty-check.
  const writes = await writeStats(db, leagueId, sport, batterStats, pitcherStats);

  return {
    league_id: leagueId,
    sport,
    box_scores_read: boxScores.length,
    players_aggregated: batterStats.length,
    players_written: writes.batter_writes,
    pitchers_written: writes.pitcher_writes,
    duration_ms: Date.now() - startedAt,
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
  batters: SoftballPlayerStats[] | BaseballBatterStats[],
  pitchers: BaseballPitcherStats[],
): Promise<{ batter_writes: number; pitcher_writes: number }> {
  // Collect EVERY player id we'll touch — batter or pitcher — so we
  // fetch their existing doc once and can dirty-check both subfields.
  const allPlayerIds = new Set<string>();
  for (const b of batters) if (b.player_id) allPlayerIds.add(b.player_id);
  for (const p of pitchers) if (p.player_id) allPlayerIds.add(p.player_id);

  const playerRefs = [...allPlayerIds].map((pid) =>
    db.doc(`leagues/${leagueId}/players/${pid}`),
  );

  const existingDocs = playerRefs.length ? await db.getAll(...playerRefs) : [];
  // Store the full doc data so we can read both `.stats` (batter) and
  // `.pitching` (pitcher) subfields. Earlier version stored only `.stats`,
  // which silently broke pitcher dirty-check (every recalc rewrote
  // pitchers even when totals were unchanged).
  const existingByPath = new Map(
    existingDocs.map((d) => [d.ref.path, d.data() ?? {}]),
  );

  const batch = db.batch();
  let batterWrites = 0;

  for (const next of batters) {
    if (!next.player_id) continue;
    const ref = db.doc(`leagues/${leagueId}/players/${next.player_id}`);
    const prev = existingByPath.get(ref.path);
    if (prev?.stats && areBatterStatsEqual(prev.stats, next, sport)) continue;
    batch.set(ref, { stats: next }, { merge: true });
    batterWrites += 1;
  }

  let pitcherWrites = 0;
  for (const p of pitchers) {
    if (!p.player_id) continue;
    const ref = db.doc(`leagues/${leagueId}/players/${p.player_id}`);
    const prev = existingByPath.get(ref.path);
    if (prev?.pitching && pitcherStatsAreEqual(prev.pitching, p)) continue;
    batch.set(ref, { pitching: p }, { merge: true });
    pitcherWrites += 1;
  }

  if (batterWrites + pitcherWrites > 0) {
    await batch.commit();
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
