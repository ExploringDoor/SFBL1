// Softball stat aggregation. Pure functions over per-game batting lines.
// Pitching is not tracked in softball (per LeaguePitching.tracked = false
// in the SFBL/KCSL config), so this module only handles batting.

import { battingAverage, onBasePct, ops, sluggingPct } from "./shared";

// One player's batting line from one game. Hits (h) is the total — must
// equal singles + doubles + triples + hr; sluggingPct enforces this.
export interface SoftballBattingLine {
  player_id: string;
  ab: number;
  r: number;
  h: number;
  doubles: number;
  triples: number;
  hr: number;
  rbi: number;
  bb: number;
  so: number;
  sb?: number;
  pb?: number; // passed balls — softball-specific
}

export interface SoftballPlayerStats {
  player_id: string;
  // Counting stats — sums across games.
  gp: number;
  ab: number;
  r: number;
  h: number;
  doubles: number;
  triples: number;
  hr: number;
  rbi: number;
  bb: number;
  so: number;
  sb: number;
  pb: number;
  // Derived.
  avg: number;
  slg: number;
  obp: number;
  ops: number;
}

function emptyStats(playerId: string): SoftballPlayerStats {
  return {
    player_id: playerId,
    gp: 0,
    ab: 0, r: 0, h: 0, doubles: 0, triples: 0, hr: 0,
    rbi: 0, bb: 0, so: 0, sb: 0, pb: 0,
    avg: 0, slg: 0, obp: 0, ops: 0,
  };
}

// Aggregate a season's batting lines into per-player season stats.
// Lines for the same player_id are summed; derived stats are computed
// once at the end on the aggregated totals.
//
// Each input line represents the player's contribution to ONE game.
// To skip a game (e.g. did not play), simply omit the line — there's
// no need for an "absent" sentinel.
export function aggregateBatting(
  lines: SoftballBattingLine[],
): SoftballPlayerStats[] {
  const acc = new Map<string, SoftballPlayerStats>();

  for (const line of lines) {
    let s = acc.get(line.player_id);
    if (!s) {
      s = emptyStats(line.player_id);
      acc.set(line.player_id, s);
    }
    s.gp += 1;
    s.ab += line.ab;
    s.r += line.r;
    s.h += line.h;
    s.doubles += line.doubles;
    s.triples += line.triples;
    s.hr += line.hr;
    s.rbi += line.rbi;
    s.bb += line.bb;
    s.so += line.so;
    s.sb += line.sb ?? 0;
    s.pb += line.pb ?? 0;
  }

  for (const s of acc.values()) {
    s.avg = battingAverage(s.h, s.ab);
    s.slg = sluggingPct(s.h, s.doubles, s.triples, s.hr, s.ab);
    s.obp = onBasePct(s.h, s.bb, s.ab);
    s.ops = ops(s.obp, s.slg);
  }

  return [...acc.values()];
}

// Idempotency helper: returns true if `next` has the same counting stats
// as `prev`. Used by the "dirty-check write" pattern (lifted from DVSL)
// to skip Firestore writes when nothing changed.
export function statsAreEqual(
  a: SoftballPlayerStats,
  b: SoftballPlayerStats,
): boolean {
  return (
    a.player_id === b.player_id &&
    a.gp === b.gp &&
    a.ab === b.ab &&
    a.r === b.r &&
    a.h === b.h &&
    a.doubles === b.doubles &&
    a.triples === b.triples &&
    a.hr === b.hr &&
    a.rbi === b.rbi &&
    a.bb === b.bb &&
    a.so === b.so &&
    a.sb === b.sb &&
    a.pb === b.pb
  );
}
