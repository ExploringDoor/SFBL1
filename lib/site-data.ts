// Server-side helpers for the global site shell (ticker, header).

import { getAdminDb } from "./firebase-admin";
import type { TickerGame } from "@/components/Ticker";
import { computeStandings, type GameResult } from "./stats/shared";

interface TeamMeta {
  name: string;
  abbrev?: string;
  color?: string;
  logoUrl?: string | null;
  ageGroup?: string;
}

interface RawGame {
  id: string;
  date: string | null;
  status: string;
  home_team_id: string;
  away_team_id: string;
  home_score: number;
  away_score: number;
}

/** One age group's ticker window. */
export interface AgeTicker {
  ageGroup: string;
  games: TickerGame[];
}

async function loadRaw(tenantId: string) {
  const db = getAdminDb();
  const [gamesSnap, teamsSnap] = await Promise.all([
    db.collection(`leagues/${tenantId}/games`).get(),
    db.collection(`leagues/${tenantId}/teams`).get(),
  ]);

  const teamMeta: Record<string, TeamMeta> = {};
  const standingsGames: GameResult[] = [];
  for (const d of teamsSnap.docs) {
    const data = d.data();
    teamMeta[d.id] = {
      name: String(data.name ?? d.id),
      abbrev: data.abbrev ? String(data.abbrev) : undefined,
      color: data.color ? String(data.color) : undefined,
      logoUrl: data.logo_url ? String(data.logo_url) : null,
      ageGroup: data.ageGroup ? String(data.ageGroup) : undefined,
    };
  }
  for (const d of gamesSnap.docs) {
    const data = d.data();
    standingsGames.push({
      home_team_id: String(data.home_team_id ?? ""),
      away_team_id: String(data.away_team_id ?? ""),
      home_score: Number(data.home_score ?? 0),
      away_score: Number(data.away_score ?? 0),
      status: (data.status ?? "draft") as GameResult["status"],
    });
  }
  const recordByTeam = new Map(
    computeStandings(standingsGames).map((r) => [
      r.team_id,
      formatRecord(r.w, r.l, r.t),
    ]),
  );

  const games: RawGame[] = gamesSnap.docs
    .map((d) => {
      const data = d.data();
      return {
        id: d.id,
        date: data.date ? String(data.date) : null,
        status: String(data.status ?? "draft"),
        home_team_id: String(data.home_team_id ?? ""),
        away_team_id: String(data.away_team_id ?? ""),
        home_score: Number(data.home_score ?? 0),
        away_score: Number(data.away_score ?? 0),
      };
    })
    .filter((g) => g.status !== "draft");

  return { games, teamMeta, recordByTeam };
}

/** Most recent `finalsN` finals + next `upcomingN` upcoming, oldest→newest. */
function window(
  games: RawGame[],
  teamMeta: Record<string, TeamMeta>,
  recordByTeam: Map<string, string>,
  finalsN: number,
  upcomingN: number,
): TickerGame[] {
  const finals = games
    .filter((g) => g.status === "final" || g.status === "approved")
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
    .slice(0, finalsN)
    .reverse();
  const upcoming = games
    .filter((g) => g.status === "scheduled")
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""))
    .slice(0, upcomingN);
  return [...finals, ...upcoming].map((g) => ({
    id: g.id,
    date: g.date,
    status: g.status,
    away_team_id: g.away_team_id,
    home_team_id: g.home_team_id,
    away_score: g.away_score,
    home_score: g.home_score,
    away_team: teamMeta[g.away_team_id] ?? { name: g.away_team_id },
    home_team: teamMeta[g.home_team_id] ?? { name: g.home_team_id },
    away_record: recordByTeam.get(g.away_team_id),
    home_record: recordByTeam.get(g.home_team_id),
  }));
}

/** League-wide ticker window (default — used by small/flat leagues). */
export async function loadTickerGames(tenantId: string): Promise<TickerGame[]> {
  const { games, teamMeta, recordByTeam } = await loadRaw(tenantId);
  return window(games, teamMeta, recordByTeam, 4, 8);
}

/**
 * Per-age-group ticker windows for the tabbed ticker. A game belongs to an
 * age group when both teams are in it (youth teams play within their age
 * group). Returns groups in age order; only groups that have teams.
 */
export async function loadAgeGroupTickers(tenantId: string): Promise<AgeTicker[]> {
  const { games, teamMeta, recordByTeam } = await loadRaw(tenantId);

  const ages = new Set<string>();
  for (const t of Object.values(teamMeta)) if (t.ageGroup) ages.add(t.ageGroup);

  return [...ages]
    .sort((a, b) => ageOrder(a) - ageOrder(b))
    .map((ageGroup) => {
      const inGroup = games.filter(
        (g) =>
          teamMeta[g.home_team_id]?.ageGroup === ageGroup &&
          teamMeta[g.away_team_id]?.ageGroup === ageGroup,
      );
      return { ageGroup, games: window(inGroup, teamMeta, recordByTeam, 5, 6) };
    });
}

function ageOrder(ageGroup: string): number {
  const m = ageGroup.match(/\d+/);
  return m ? parseInt(m[0], 10) : 999;
}

function formatRecord(w: number, l: number, t: number): string {
  return t > 0 ? `${w}-${l}-${t}` : `${w}-${l}`;
}
