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
  division?: string | null;
  ageGroup?: string;
}

// Closes H10. The layout fires loadTickerGames(tenantId) on EVERY
// request — without caching, every page navigation re-pulled the
// full /games + /teams collections (~450 docs for SFBL at launch).
// On a busy Sunday with 18 captains × 6 page-views, that's ~50k
// ticker-only Firestore reads per game day.
//
// Process-local in-memory cache keyed by tenantId. 30s TTL is short
// enough that admin schedule edits land in the ticker quickly,
// long enough to soak up a captain's typical page-hopping burst.
// Cache survives per Node process — each Vercel cold-start gets a
// fresh map, which is fine for a low-tenancy launch.
//
// Audit M12: acknowledged as intentional. Every cold start re-reads
// the full /games + /teams collections; acceptable at 1-2 tenants
// with the 30s TTL absorbing bursts. Revisit (shared Edge cache /
// the standings Cloud Function, PLAN.md §10) before scaling tenants.
interface TickerCacheEntry {
  games: TickerGame[];
  expires_at: number;
}
const TICKER_TTL_MS = 30_000;
const tickerCache = new Map<string, TickerCacheEntry>();

export async function loadTickerGames(tenantId: string): Promise<TickerGame[]> {
  // Cache hit short-circuits the entire fetch + compute.
  const cached = tickerCache.get(tenantId);
  if (cached && Date.now() < cached.expires_at) {
    return cached.games;
  }

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
      division: data.division ? String(data.division) : null,
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
  const standings = computeStandings(standingsGames);
  const recordByTeam = new Map(
    standings.map((r) => [r.team_id, formatRecord(r.w, r.l, r.t)]),
  );

  // Pick a window: most recent 4 finals + next 6 upcoming, by date.
  // Filter step:
  //   - drop draft games (incomplete admin edits)
  //   - drop Boomers-division games (LBDC convention — the ticker
  //     only carries the main Saturday Division; secondary
  //     mid-week / Boomers / development-league games sit on the
  //     dedicated /scores + /schedule pages). The check is on the
  //     teams' division metadata so any future tenant with a
  //     similarly-named secondary division gets the same treatment
  //     automatically. To turn this off for a tenant, blank out the
  //     `division` field on those teams.
  function isSecondaryDivision(teamId: string): boolean {
    const div = teamMeta[teamId]?.division ?? "";
    return /boomers/i.test(div);
  }
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
    .filter((g) => g.status !== "draft")
    .filter(
      (g) =>
        !isSecondaryDivision(g.away_team_id) &&
        !isSecondaryDivision(g.home_team_id),
    );

  // Age-grouped tenants (COYBL) want every age group represented so the
  // ticker's per-age filter always has games to show — cap N per age
  // instead of taking the global most-recent N (which would skew to
  // whatever age played last). Flat tenants keep the original window.
  const ageOf = (g: { home_team_id: string; away_team_id: string }): string | null =>
    teamMeta[g.home_team_id]?.ageGroup ??
    teamMeta[g.away_team_id]?.ageGroup ??
    null;
  const hasAge = Object.values(teamMeta).some((t) => t.ageGroup);
  function capPerAge<T extends { home_team_id: string; away_team_id: string }>(
    list: T[],
    n: number,
  ): T[] {
    const seen = new Map<string, number>();
    const out: T[] = [];
    for (const g of list) {
      const a = ageOf(g);
      if (a) {
        const c = seen.get(a) ?? 0;
        if (c >= n) continue;
        seen.set(a, c + 1);
      }
      out.push(g);
    }
    return out;
  }

  const finalsSorted = all
    .filter((g) => g.status === "final" || g.status === "approved")
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  const upcomingSorted = all
    .filter((g) => g.status === "scheduled")
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));

  const finals = (hasAge ? capPerAge(finalsSorted, 3) : finalsSorted.slice(0, 4))
    .slice(0, 40)
    .reverse();
  const upcoming = (
    hasAge ? capPerAge(upcomingSorted, 3) : upcomingSorted.slice(0, 8)
  ).slice(0, 40);

  const result: TickerGame[] = [...finals, ...upcoming].map((g) => ({
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
    ageGroup: ageOf(g) ?? undefined,
  }));
  tickerCache.set(tenantId, {
    games: result,
    expires_at: Date.now() + TICKER_TTL_MS,
  });
  return result;
}

function formatRecord(w: number, l: number, t: number): string {
  return t > 0 ? `${w}-${l}-${t}` : `${w}-${l}`;
}
