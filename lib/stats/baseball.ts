// Baseball stat aggregation. Batting (similar to softball, no PB) plus
// pitching (the piece softball doesn't have).
//
// IP is stored as integer outs throughout. ERA and WHIP math uses
// outs * 27 / outs and outs * 3 / outs forms to avoid float precision.

import { battingAverage, onBasePct, ops, sluggingPct } from "./shared";

// =============================================================================
// Batting
// =============================================================================

export interface BaseballBattingLine {
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
}

export interface BaseballBatterStats {
  player_id: string;
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
  avg: number;
  slg: number;
  obp: number;
  ops: number;
}

function emptyBatter(playerId: string): BaseballBatterStats {
  return {
    player_id: playerId,
    gp: 0,
    ab: 0, r: 0, h: 0, doubles: 0, triples: 0, hr: 0,
    rbi: 0, bb: 0, so: 0, sb: 0,
    avg: 0, slg: 0, obp: 0, ops: 0,
  };
}

export function aggregateBatting(
  lines: BaseballBattingLine[],
): BaseballBatterStats[] {
  const acc = new Map<string, BaseballBatterStats>();

  for (const line of lines) {
    let s = acc.get(line.player_id);
    if (!s) {
      s = emptyBatter(line.player_id);
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
  }

  for (const s of acc.values()) {
    s.avg = battingAverage(s.h, s.ab);
    s.slg = sluggingPct(s.h, s.doubles, s.triples, s.hr, s.ab);
    s.obp = onBasePct(s.h, s.bb, s.ab);
    s.ops = ops(s.obp, s.slg);
  }

  return [...acc.values()];
}

// =============================================================================
// Pitching
// =============================================================================

export type PitchingDecision = "W" | "L" | "S";

export interface BaseballPitchingLine {
  player_id: string;
  ip_outs: number; // see lib/stats/ip.ts — total outs recorded
  h: number;
  r: number;
  er: number;
  bb: number;
  so: number;
  hr: number;
  decision?: PitchingDecision;
}

export interface BaseballPitcherStats {
  player_id: string;
  app: number; // appearances (may be > games if relief in same game)
  w: number;
  l: number;
  sv: number;
  ip_outs: number;
  h: number;
  r: number;
  er: number;
  bb: number;
  so: number;
  hr: number;
  era: number;
  whip: number;
}

function emptyPitcher(playerId: string): BaseballPitcherStats {
  return {
    player_id: playerId,
    app: 0, w: 0, l: 0, sv: 0,
    ip_outs: 0,
    h: 0, r: 0, er: 0, bb: 0, so: 0, hr: 0,
    era: 0, whip: 0,
  };
}

// ERA = (ER * 27) / outs. Returns 0 for 0 outs to match how DVSL/LB
// display unpitched lines (rather than NaN or Infinity).
function era(er: number, outs: number): number {
  if (outs === 0) return 0;
  return (er * 27) / outs;
}

// WHIP = (H + BB) * 3 / outs. Same 0-outs handling as ERA.
function whip(h: number, bb: number, outs: number): number {
  if (outs === 0) return 0;
  return ((h + bb) * 3) / outs;
}

export function aggregatePitching(
  lines: BaseballPitchingLine[],
): BaseballPitcherStats[] {
  const acc = new Map<string, BaseballPitcherStats>();

  for (const line of lines) {
    if (line.ip_outs < 0 || !Number.isInteger(line.ip_outs)) {
      throw new Error(
        `aggregatePitching: ip_outs must be a non-negative integer, got ${line.ip_outs}. ` +
          `(Use ip.ts parseIP / ipFromInningsAndOuts to construct.)`,
      );
    }
    let s = acc.get(line.player_id);
    if (!s) {
      s = emptyPitcher(line.player_id);
      acc.set(line.player_id, s);
    }
    s.app += 1;
    s.ip_outs += line.ip_outs;
    s.h += line.h;
    s.r += line.r;
    s.er += line.er;
    s.bb += line.bb;
    s.so += line.so;
    s.hr += line.hr;
    if (line.decision === "W") s.w += 1;
    else if (line.decision === "L") s.l += 1;
    else if (line.decision === "S") s.sv += 1;
  }

  for (const s of acc.values()) {
    s.era = era(s.er, s.ip_outs);
    s.whip = whip(s.h, s.bb, s.ip_outs);
  }

  return [...acc.values()];
}

// Dirty-check helpers, mirroring softball's pattern.
export function batterStatsAreEqual(
  a: BaseballBatterStats,
  b: BaseballBatterStats,
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
    a.sb === b.sb
  );
}

export function pitcherStatsAreEqual(
  a: BaseballPitcherStats,
  b: BaseballPitcherStats,
): boolean {
  return (
    a.player_id === b.player_id &&
    a.app === b.app &&
    a.w === b.w &&
    a.l === b.l &&
    a.sv === b.sv &&
    a.ip_outs === b.ip_outs &&
    a.h === b.h &&
    a.r === b.r &&
    a.er === b.er &&
    a.bb === b.bb &&
    a.so === b.so &&
    a.hr === b.hr
  );
}
