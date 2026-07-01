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
