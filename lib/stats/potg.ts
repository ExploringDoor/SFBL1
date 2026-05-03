// Player of the Game scoring. Lifted from Long Beach's calcPOTG pattern
// per the Phase 3 scouting report. Pure function over a single game's
// batting + pitching lines from one team or both.
//
// Scoring weights (Long Beach baseball — adjust per league later if
// needed via config):
//   Batter:  h*3 + hr*4 + rbi*2 + r*1 + bb*0.5 - k*0.3
//   Pitcher: k*1 + ip*0.5 + (W?3:0) - er*1.5
//
// The "totals" row in some box scores has player_id absent or special;
// we filter those out before scoring.

import { ipDecimal } from "./ip";

export interface POTGBatterLine {
  player_id: string;
  ab?: number;
  r?: number;
  h?: number;
  hr?: number;
  rbi?: number;
  bb?: number;
  so?: number;
}

export interface POTGPitcherLine {
  player_id: string;
  ip_outs?: number;
  er?: number;
  so?: number;
  decision?: "W" | "L" | "S";
}

export interface POTGResult {
  player_id: string;
  score: number;
  source: "batting" | "pitching";
}

export function batterScore(line: POTGBatterLine): number {
  const h = line.h ?? 0;
  const hr = line.hr ?? 0;
  const rbi = line.rbi ?? 0;
  const r = line.r ?? 0;
  const bb = line.bb ?? 0;
  const so = line.so ?? 0;
  return h * 3 + hr * 4 + rbi * 2 + r * 1 + bb * 0.5 - so * 0.3;
}

export function pitcherScore(line: POTGPitcherLine): number {
  const so = line.so ?? 0;
  const ip = ipDecimal(line.ip_outs ?? 0);
  const er = line.er ?? 0;
  const winBonus = line.decision === "W" ? 3 : 0;
  return so * 1 + ip * 0.5 + winBonus - er * 1.5;
}

// Returns the single best player across both lineups + pitching staffs.
// Returns null if all input lines are empty / skipped.
export function calcPOTG(
  batters: POTGBatterLine[],
  pitchers: POTGPitcherLine[],
): POTGResult | null {
  let best: POTGResult | null = null;

  // Aggregate per-player score so a pitcher who also batted gets one
  // combined score, matching how Long Beach's calcPOTG treats them.
  const scores = new Map<string, { score: number; source: "batting" | "pitching" }>();

  for (const b of batters) {
    if (!b.player_id) continue;
    const s = batterScore(b);
    const prev = scores.get(b.player_id);
    if (!prev) scores.set(b.player_id, { score: s, source: "batting" });
    else
      scores.set(b.player_id, {
        score: prev.score + s,
        source: prev.source, // keep first-seen source for display
      });
  }
  for (const p of pitchers) {
    if (!p.player_id) continue;
    const s = pitcherScore(p);
    const prev = scores.get(p.player_id);
    if (!prev) scores.set(p.player_id, { score: s, source: "pitching" });
    else
      scores.set(p.player_id, {
        score: prev.score + s,
        // If they also batted, prefer "pitching" as the source label
        // when the pitching line is non-trivial.
        source: (p.ip_outs ?? 0) >= 9 ? "pitching" : prev.source,
      });
  }

  for (const [player_id, { score, source }] of scores) {
    if (best === null || score > best.score) {
      best = { player_id, score, source };
    }
  }
  return best;
}
