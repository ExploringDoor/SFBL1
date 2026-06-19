// Shared standings loader. Used by both the /standings page and the home
// sidebar so the Age Group -> Division hierarchy is computed in one place.
//
// Tenants WITHOUT age groups (e.g. SFBL) get a single section with flat
// division groups computed globally (original behavior, preserved). Tenants
// WITH `ageGroup` on team docs (COYBL) get one section per age group, each
// division's standings computed from that division's games alone.

import { getAdminDb } from "./firebase-admin";
import {
  computeStandings,
  sortByPoints,
  type GameResult,
  type StandingsRow,
} from "./stats/shared";
import type { PublicLeagueConfig } from "./tenants";
import type { DivisionGroup, TeamMeta } from "@/components/StandingsTable";

export interface AgeSection {
  ageGroup: string | null;
  groups: DivisionGroup[];
}

export type TeamMetaPlus = TeamMeta & { ageGroup?: string };

export interface StandingsData {
  ageSections: AgeSection[];
  teams: Record<string, TeamMetaPlus>;
  scheme: { win: number; tie: number; loss: number } | null;
  throughDate: string;
  teamCount: number;
}

export async function loadStandingsSections(
  tenantId: string,
  config: PublicLeagueConfig | null,
): Promise<StandingsData> {
  const db = getAdminDb();
  const [gamesSnap, teamsSnap] = await Promise.all([
    db.collection(`leagues/${tenantId}/games`).get(),
    db.collection(`leagues/${tenantId}/teams`).get(),
  ]);

  const teams: Record<string, TeamMetaPlus> = {};
  for (const d of teamsSnap.docs) {
    const data = d.data();
    teams[d.id] = {
      name: String(data.name ?? d.id),
      abbrev: data.abbrev ? String(data.abbrev) : undefined,
      color: data.color ? String(data.color) : undefined,
      logoUrl: data.logo_url ? String(data.logo_url) : null,
      division: data.division ? String(data.division) : undefined,
      ageGroup: data.ageGroup ? String(data.ageGroup) : undefined,
    };
  }

  const games: GameResult[] = gamesSnap.docs.map((d) => {
    const data = d.data();
    return {
      home_team_id: String(data.home_team_id ?? ""),
      away_team_id: String(data.away_team_id ?? ""),
      home_score: Number(data.home_score ?? 0),
      away_score: Number(data.away_score ?? 0),
      status: (data.status ?? "draft") as GameResult["status"],
      date: data.date ? String(data.date) : undefined,
    };
  });

  const usePoints =
    config?.standings?.scoring === "points" && !!config?.standings?.points_per;
  const scheme = usePoints ? config!.standings!.points_per! : null;
  const tiebreaker = config?.standings?.tiebreaker ?? "rd";
  const rank = (subset: GameResult[]): StandingsRow[] => {
    let rows = computeStandings(subset);
    if (usePoints && scheme) rows = sortByPoints(rows, scheme, tiebreaker);
    return rows;
  };

  const hasAgeGroups = Object.values(teams).some((t) => t.ageGroup);

  let ageSections: AgeSection[];
  if (hasAgeGroups) {
    const byAge = new Map<string, Map<string, string[]>>();
    for (const [id, t] of Object.entries(teams)) {
      const ageGroup = t.ageGroup ?? "Other";
      const division = t.division ?? "Division";
      if (!byAge.has(ageGroup)) byAge.set(ageGroup, new Map());
      const divMap = byAge.get(ageGroup)!;
      if (!divMap.has(division)) divMap.set(division, []);
      divMap.get(division)!.push(id);
    }
    ageSections = [...byAge.entries()]
      .sort(([a], [b]) => ageOrder(a) - ageOrder(b))
      .map(([ageGroup, divMap]) => {
        const groups: DivisionGroup[] = [...divMap.entries()]
          .sort(([a], [b]) => divOrder(a) - divOrder(b))
          .map(([division, ids]) => {
            const idSet = new Set(ids);
            const divGames = games.filter(
              (g) => idSet.has(g.home_team_id) && idSet.has(g.away_team_id),
            );
            return { division, rows: rank(divGames) };
          });
        return { ageGroup, groups };
      });
  } else {
    ageSections = [{ ageGroup: null, groups: groupByDivision(rank(games), teams) }];
  }

  const finalDates = games
    .filter((g) => g.status === "final" || g.status === "approved")
    .map((g) => g.date ?? "")
    .filter(Boolean)
    .sort();
  const lastDate = finalDates[finalDates.length - 1];
  const throughDate = lastDate
    ? new Date(lastDate).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "today";

  return { ageSections, teams, scheme, throughDate, teamCount: teamsSnap.size };
}

function groupByDivision(
  rows: StandingsRow[],
  teamMeta: Record<string, TeamMeta>,
): DivisionGroup[] {
  const anyDivision = rows.some((r) => teamMeta[r.team_id]?.division);
  if (!anyDivision) return [{ division: null, rows }];
  const buckets = new Map<string, StandingsRow[]>();
  for (const r of rows) {
    const div = teamMeta[r.team_id]?.division ?? "Other";
    if (!buckets.has(div)) buckets.set(div, []);
    buckets.get(div)!.push(r);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([division, rows]) => ({ division, rows }));
}

// "7U" -> 7, "10U" -> 10. Unknown sorts last.
export function ageOrder(ageGroup: string): number {
  const m = ageGroup.match(/\d+/);
  return m ? parseInt(m[0], 10) : 999;
}

// "Division 1" -> 1, "Division 5A" -> 5.01, "Division 5B" -> 5.02.
export function divOrder(division: string): number {
  const m = division.match(/(\d+)\s*([A-Za-z]?)/);
  if (!m || m[1] == null) return 999;
  const n = parseInt(m[1], 10);
  const sub = m[2] ? (m[2].toUpperCase().charCodeAt(0) - 64) / 100 : 0;
  return n + sub;
}
