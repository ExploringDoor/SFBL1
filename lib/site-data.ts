// Server-side helpers that fetch the data the global site shell (ticker,
// header) needs on every page. Kept separate from page-level loaders so
// the layout doesn't need bespoke fetches.

import { getAdminDb } from "./firebase-admin";
import { teamLogoSrc } from "./team-logo";
import type { TickerGame } from "@/components/ui/Ticker";
import {
  computeStandingsWithExtraGameRule,
  type GameResult, scoreOrNull } from "./stats/shared";
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

/** Test-only. The 30s cache is process-wide, so a suite that reuses one tenant
 *  id gets the FIRST case's result for every later case. That is not
 *  hypothetical: it silently neutered 12 of the 17 ticker tests from 53a8e26
 *  (May 11) until 2026-09-08, which is how the b4f00ab argument swap reached
 *  production. Call this in beforeEach. */
export function __resetTickerCache(): void {
  tickerCache.clear();
}

export interface TickerOptions {
  /** Schedule hidden while it is rebuilt. Upcoming fixtures come out of the
   *  ticker with it; finals stay, because a played game is not in flux. The
   *  ticker sits in the header of EVERY page, so leaving it alone would have
   *  advertised the fixtures the schedule page had just taken down. */
  scheduleHidden?: boolean;
  /** League setting standings.drop_extra_game_loss. The ticker prints a record
   *  next to each team in the header of every page, so it has to match
   *  /standings or the site contradicts itself. Off by default, which is every
   *  league that has not asked for the rule. */
  dropExtraGameLoss?: boolean;
}

/** Options are NAMED, not positional, and deliberately so. They used to be two
 *  adjacent booleans; b4f00ab added `scheduleHidden` as parameter 2 while the
 *  layout passed it as argument 3, so `drop_extra_game_loss: true` arrived as
 *  `scheduleHidden` and silently emptied the ticker on every page of every
 *  tenant that had the rule on. Nothing failed loudly: both are booleans, both
 *  default false, and the tenant that had it on had no finals to fall back on.
 *  Keep them named so the next flag cannot repeat it. */
export async function loadTickerGames(
  tenantId: string,
  opts: TickerOptions = {},
): Promise<TickerGame[]> {
  const { scheduleHidden = false, dropExtraGameLoss = false } = opts;

  // Cache hit short-circuits the entire fetch + compute. The key carries the
  // flags: both change the RESULT, so keying on tenant alone let one request
  // during a hidden window serve an empty ticker to everyone for 30s.
  const cacheKey = `${tenantId}|${scheduleHidden ? 1 : 0}${dropExtraGameLoss ? 1 : 0}`;
  const cached = tickerCache.get(cacheKey);
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
      // WORST OF THE LOT, and the easiest to miss. This meta is copied whole
      // into every TickerGame below, Ticker hands `games` to TickerTrack, and
      // TickerTrack is a client component. app/layout.tsx calls loadTickerGames
      // on EVERY page of EVERY tenant, so an unrouted data: logo here is not a
      // one page problem, it is a whole site problem. Island read clean on
      // 2026-08-20 only because all twelve of its games belonged to demo teams.
      // Fall play starts 2026-09-12.
      logoUrl: teamLogoSrc(tenantId, d.id, data.logo_url),
      division: data.division ? String(data.division) : null,
      ageGroup: data.ageGroup ? String(data.ageGroup) : undefined,
    };
  }

  for (const d of gamesSnap.docs) {
    const data = d.data();
    standingsGames.push({
      home_team_id: String(data.home_team_id ?? ""),
      away_team_id: String(data.away_team_id ?? ""),
      home_score: scoreOrNull(data.home_score),
      away_score: scoreOrNull(data.away_score),
      status: (data.status ?? "draft") as GameResult["status"],
    });
  }
  const standings = computeStandingsWithExtraGameRule(standingsGames, {
    enabled: dropExtraGameLoss,
    divisionOf: (id) => teamMeta[id]?.division ?? "",
  });
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

  const result: TickerGame[] = [...finals, ...(scheduleHidden ? [] : upcoming)].map((g) => ({
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
  tickerCache.set(cacheKey, {
    games: result,
    expires_at: Date.now() + TICKER_TTL_MS,
  });
  return result;
}

function formatRecord(w: number, l: number, t: number): string {
  return t > 0 ? `${w}-${l}-${t}` : `${w}-${l}`;
}
