// Shared helpers for age-grouped standings (COYBL): build StandingsRow[]
// from stored league records, and group rows into Age Group -> Division
// sections. Used by both the full standings page and the homepage
// age-switcher so they stay in lockstep.

import type { StandingsRow } from "@/lib/stats/shared";
import type { TeamMeta, DivisionGroup } from "@/components/ui/StandingsTable";

export interface TeamExtra {
  ageGroup?: string;
  ageOrder: number;
  divOrder: number;
}

export interface AgeSection {
  ageGroup: string;
  divisionGroups: DivisionGroup[];
}

// Does this tenant publish official records that the games can't reproduce?
//
// True for stats-off tenants whose source site is the authority on W-L-T:
// COYBL (the source flags which games count) and HSA/Helena (Division I and
// Division E play crossover games that count in neither division's table,
// so recomputing credits Division I teams with four phantom wins each).
//
// Every surface that shows a record — standings, schedule cards, scores
// cards, the homepage — must agree, so they all gate on this one predicate
// rather than each deciding for itself. Tenants that compute normally
// (SFBL, LBDC) have stats_enabled unset and are unaffected.
//
// `flags.use_stored_records` exists because the two questions are NOT the
// same question:
//
//   "does this league publish its own W-L-T?"   (standings source)
//   "does this league have player stats?"       (are /players and /leaders real)
//
// Reading the first off stats_enabled worked while every stored-records
// tenant also happened to have no player data. JFK broke that: it publishes
// official records that can't be recomputed (crossover play in the INTER
// division, plus forfeit wins), AND it has 280 pitchers' worth of real box
// score data. Under the old predicate, turning its stat pages on would have
// silently switched its standings to a recomputed table that disagrees with
// the league's own published numbers.
//
// So: the explicit flag wins when set; otherwise fall back to the original
// stats_enabled===false behaviour, which keeps COYBL and Helena unchanged.
export function useStoredRecords(
  config: { flags?: { [key: string]: boolean } } | null | undefined,
  records: Record<string, { w: number; l: number; t: number }>,
): boolean {
  if (Object.keys(records).length === 0) return false;
  if (config?.flags?.use_stored_records === true) return true;
  return config?.flags?.stats_enabled === false;
}

// Build StandingsRow[] from stored league records (stats-off leagues).
// No run data (rs/ra/rd = 0) or streak — the record columns are all these
// leagues have. Sorted best-record-first so the table renders in standings
// order (and row 0 gets the leader highlight).
export function recordsToStandings(
  records: Record<string, { w: number; l: number; t: number }>,
): StandingsRow[] {
  return Object.entries(records)
    .map(([team_id, { w, l, t }]) => {
      const gp = w + l + t;
      return {
        team_id,
        gp,
        w,
        l,
        t,
        rs: 0,
        ra: 0,
        rd: 0,
        pct: gp > 0 ? (w + 0.5 * t) / gp : 0,
        gb: 0,
      };
    })
    .sort((a, b) => b.pct - a.pct || b.w - a.w || a.l - b.l);
}

// Group rows into Age Group -> Division sections. Ages sorted by ageOrder
// (7U->14U), divisions within each by divOrder. Row order within a division
// is preserved (callers pass already-sorted rows).
export function buildAgeSections(
  rows: StandingsRow[],
  teamMeta: Record<string, TeamMeta>,
  teamExtra: Record<string, TeamExtra>,
): AgeSection[] {
  const byAge = new Map<string, StandingsRow[]>();
  for (const r of rows) {
    const ag = teamExtra[r.team_id]?.ageGroup ?? "Other";
    if (!byAge.has(ag)) byAge.set(ag, []);
    byAge.get(ag)!.push(r);
  }
  const ageOrderOf = (ag: string) => {
    const r = rows.find((x) => (teamExtra[x.team_id]?.ageGroup ?? "Other") === ag);
    return r ? teamExtra[r.team_id]?.ageOrder ?? 999 : 999;
  };
  return [...byAge.entries()]
    .sort(([a], [b]) => ageOrderOf(a) - ageOrderOf(b) || a.localeCompare(b))
    .map(([ageGroup, ageRows]) => {
      const byDiv = new Map<string, StandingsRow[]>();
      for (const r of ageRows) {
        const div = teamMeta[r.team_id]?.division ?? "Division";
        if (!byDiv.has(div)) byDiv.set(div, []);
        byDiv.get(div)!.push(r);
      }
      const divOrderOf = (div: string) => {
        const r = ageRows.find(
          (x) => (teamMeta[x.team_id]?.division ?? "Division") === div,
        );
        return r ? teamExtra[r.team_id]?.divOrder ?? 999 : 999;
      };
      const divisionGroups: DivisionGroup[] = [...byDiv.entries()]
        .sort(([a], [b]) => divOrderOf(a) - divOrderOf(b) || a.localeCompare(b))
        .map(([division, rs]) => ({ division, rows: rs }));
      return { ageGroup, divisionGroups };
    });
}
