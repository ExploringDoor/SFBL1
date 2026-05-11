// Server-side helpers that fetch the data the global site shell (ticker,
// header) needs on every page. Kept separate from page-level loaders so
// the layout doesn't need bespoke fetches.

import { getAdminDb } from "./firebase-admin";
import type { TickerGame } from "@/components/ui/Ticker";
import { computeStandings, type GameResult } from "./stats/shared";
import { combineDateTime } from "./format-time";

interface TeamMeta {
  name: string;
  abbrev?: string;
  color?: string;
  logoUrl?: string | null;
}

export async function loadTickerGames(tenantId: string): Promise<TickerGame[]> {
  // Defensive: the layout calls this on every request. If Firebase
  // Admin SDK can't init (missing service account env, network
  // failure, quota exhausted), we'd otherwise crash the layout and
  // every page on the site. Return an empty ticker instead — the
  // ticker just won't show games.
  let db;
  try {
    db = getAdminDb();
  } catch (e) {
    console.error("[site-data] getAdminDb failed:", e);
    return [];
  }
  let gamesSnap, teamsSnap;
  try {
    [gamesSnap, teamsSnap] = await Promise.all([
      db.collection(`leagues/${tenantId}/games`).get(),
      db.collection(`leagues/${tenantId}/teams`).get(),
    ]);
  } catch (e) {
    console.error("[site-data] Firestore read failed:", e);
    return [];
  }

  const teamMeta: Record<string, TeamMeta> = {};
  const standingsGames: GameResult[] = [];
  for (const d of teamsSnap.docs) {
    const data = d.data();
    teamMeta[d.id] = {
      name: String(data.name ?? d.id),
      abbrev: data.abbrev ? String(data.abbrev) : undefined,
      color: data.color ? String(data.color) : undefined,
      logoUrl: data.logo_url ? String(data.logo_url) : null,
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
  const standings = computeStandings(standingsGames);
  const recordByTeam = new Map(
    standings.map((r) => [r.team_id, formatRecord(r.w, r.l, r.t)]),
  );

  // Pick a window: most recent 4 finals + next 6 upcoming, by date.
  const all = gamesSnap.docs
    .map((d) => {
      const data = d.data();
      // Combine the (sometimes separate) date + time fields so the
      // Ticker, which only sees a single `date` string, can still
      // render "9:05 AM" instead of falling back to "12:00 AM" when
      // the time lived in a sibling field.
      const combined = combineDateTime(
        data.date ? String(data.date) : null,
        data.time ? String(data.time) : null,
      );
      return {
        id: d.id,
        date: combined || null,
        status: String(data.status ?? "draft"),
        home_team_id: String(data.home_team_id ?? ""),
        away_team_id: String(data.away_team_id ?? ""),
        home_score: Number(data.home_score ?? 0),
        away_score: Number(data.away_score ?? 0),
      };
    })
    .filter((g) => g.status !== "draft");

  const finals = all
    .filter((g) => g.status === "final" || g.status === "approved")
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
    .slice(0, 4)
    .reverse();

  const upcoming = all
    .filter((g) => g.status === "scheduled")
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""))
    .slice(0, 8);

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

function formatRecord(w: number, l: number, t: number): string {
  return t > 0 ? `${w}-${l}-${t}` : `${w}-${l}`;
}
