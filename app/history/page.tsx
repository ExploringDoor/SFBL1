// League history page — public archive of every recorded SFBL season
// going back to 2003. Other tenants render an empty state until their
// own `data/{tenantId}/historical-standings.json` lands.
//
// Architecture:
//   - This (server) page loads the JSON archive + team metadata from
//     the live Firestore (so we can match historical team names to
//     current logos / brand colors / club detail pages where the
//     names match), computes derived stats (champion list, all-time
//     leaderboards), and hands a fully-baked view-model to the
//     Client Component below.
//   - <HistoryView /> handles tabs, animations, filter input. No
//     server traffic from tab clicks — the entire archive is one
//     payload.
//
// Why ship the entire 256KB JSON to the client:
//   The whole archive is read-only, infinitely cacheable, and small
//   enough that splitting per-season would add round-trips for what
//   is fundamentally a "browse around" experience. Gzip cuts it to
//   ~40KB on the wire.

import * as fs from "node:fs";
import * as path from "node:path";
import { headers } from "next/headers";
import { getAdminDb } from "@/lib/firebase-admin";
import { HistoryView } from "./HistoryView";
import type {
  ChampionRow,
  HistoryViewProps,
  LeaderboardRow,
  StandingsBlock,
  TeamMeta,
} from "./types";
import "./history.css";

export const dynamic = "force-dynamic";

function loadHistory(tenantId: string): StandingsBlock[] {
  const file = path.resolve(
    process.cwd(),
    `data/${tenantId}/historical-standings.json`,
  );
  if (!fs.existsSync(file)) return [];
  try {
    const raw = fs.readFileSync(file, "utf8");
    return JSON.parse(raw) as StandingsBlock[];
  } catch {
    return [];
  }
}

async function loadTeamMeta(tenantId: string): Promise<TeamMeta[]> {
  // Pull the current teams collection so we can match historical
  // team names to active clubs (logos, colors, division). Teams that
  // don't exist anymore just don't get a logo — that's fine.
  try {
    const db = getAdminDb();
    const snap = await db.collection(`leagues/${tenantId}/teams`).get();
    return snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        name: String(data.name ?? d.id),
        color: data.color ? String(data.color) : null,
        logoUrl: data.logo_url ? String(data.logo_url) : null,
      };
    });
  } catch {
    // Firestore unavailable in dev / no creds — fall through with no
    // meta. The page still renders, just without logos.
    return [];
  }
}

/** Build a quick lookup from a historical "team" string → current
 *  team meta, when the names match (case-insensitive, trimmed).
 *  Doesn't try fuzzy matching across years — "Boca Mets" of 2010
 *  may or may not be the same franchise as "Boca Mets" of 2026.
 *  Same exact name → assume continuity. Different name → no link. */
function buildNameIndex(teams: TeamMeta[]): Record<string, TeamMeta> {
  const idx: Record<string, TeamMeta> = {};
  for (const t of teams) {
    idx[t.name.trim().toLowerCase()] = t;
  }
  return idx;
}

function deriveChampions(
  all: StandingsBlock[],
  nameIdx: Record<string, TeamMeta>,
): ChampionRow[] {
  // Group playoff blocks by season → list of {division, team}.
  const bySeason = new Map<
    string,
    { division: string; team: string; meta: TeamMeta | null }[]
  >();
  for (const b of all) {
    if (b.game_type !== "playoff") continue;
    if (b.standings.length === 0) continue;
    const top = b.standings[0]!;
    // Only count undefeated playoff teams as the bracket champion.
    // Sparse old-year data sometimes has a single round of W-L
    // recorded — flagging the top of that as champion is misleading.
    if (top.l > 0) continue;
    const meta = nameIdx[top.team.trim().toLowerCase()] ?? null;
    const arr = bySeason.get(b.season) ?? [];
    arr.push({ division: b.division, team: top.team, meta });
    bySeason.set(b.season, arr);
  }
  const rows: ChampionRow[] = [];
  for (const [season, divisions] of bySeason) {
    rows.push({ season, divisions });
  }
  rows.sort((a, b) => seasonKey(b.season) - seasonKey(a.season));
  return rows;
}

function deriveChampionsLeaderboard(
  champions: ChampionRow[],
  nameIdx: Record<string, TeamMeta>,
): LeaderboardRow[] {
  const counts = new Map<string, { count: number; seasons: string[] }>();
  for (const row of champions) {
    for (const d of row.divisions) {
      const key = d.team.trim();
      const cur = counts.get(key) ?? { count: 0, seasons: [] };
      cur.count += 1;
      cur.seasons.push(row.season);
      counts.set(key, cur);
    }
  }
  const rows: LeaderboardRow[] = [];
  for (const [team, c] of counts) {
    rows.push({
      team,
      meta: nameIdx[team.toLowerCase()] ?? null,
      count: c.count,
      detail: c.seasons,
    });
  }
  rows.sort((a, b) => b.count - a.count || a.team.localeCompare(b.team));
  return rows;
}

function deriveWinsLeaderboard(
  all: StandingsBlock[],
  nameIdx: Record<string, TeamMeta>,
): LeaderboardRow[] {
  // Sum regular-season W only — playoff W double-counts the same
  // game and isn't a "career" stat in a way most fans expect.
  const wins = new Map<
    string,
    { wins: number; seasons: Set<string> }
  >();
  for (const b of all) {
    if (b.game_type !== "season") continue;
    for (const r of b.standings) {
      const key = r.team.trim();
      const cur = wins.get(key) ?? { wins: 0, seasons: new Set() };
      cur.wins += r.w;
      cur.seasons.add(b.season);
      wins.set(key, cur);
    }
  }
  const rows: LeaderboardRow[] = [];
  for (const [team, c] of wins) {
    if (c.wins === 0) continue;
    rows.push({
      team,
      meta: nameIdx[team.toLowerCase()] ?? null,
      count: c.wins,
      detail: [`Across ${c.seasons.size} season${c.seasons.size === 1 ? "" : "s"}`],
    });
  }
  rows.sort((a, b) => b.count - a.count || a.team.localeCompare(b.team));
  return rows.slice(0, 25); // top 25 — beyond that the long tail isn't interesting
}

export default async function HistoryPage() {
  const h = headers();
  const tenantId = h.get("x-tenant-id");
  if (!tenantId) {
    return (
      <main className="container py-12">
        <p>Visit a tenant subdomain.</p>
      </main>
    );
  }

  const [all, teams] = await Promise.all([
    Promise.resolve(loadHistory(tenantId)),
    loadTeamMeta(tenantId),
  ]);

  if (all.length === 0) {
    return (
      <main className="container py-10">
        <Header />
        <div className="le-history-empty">
          <strong>League history is not available yet.</strong>
          <p>Once past seasons are archived, they'll appear here.</p>
        </div>
      </main>
    );
  }

  const nameIdx = buildNameIndex(teams);
  const champions = deriveChampions(all, nameIdx);
  const championsLb = deriveChampionsLeaderboard(champions, nameIdx);
  const winsLb = deriveWinsLeaderboard(all, nameIdx);

  // Headline stats for the hero strip.
  const seasonCount = new Set(all.map((b) => b.season)).size;
  const oldestSeason = [...new Set(all.map((b) => b.season))].sort(
    (a, b) => seasonKey(a) - seasonKey(b),
  )[0]!;
  const oldestYear = /\d{4}/.exec(oldestSeason)?.[0] ?? "";
  const totalChampionships = championsLb.reduce(
    (a, b) => a + b.count,
    0,
  );
  const teamCount = new Set(
    all.flatMap((b) => b.standings.map((r) => r.team.trim())),
  ).size;

  const props: HistoryViewProps = {
    all,
    nameIdx,
    champions,
    championsLb,
    winsLb,
    stats: {
      seasonCount,
      oldestYear,
      totalChampionships,
      teamCount,
    },
  };

  return (
    <main className="container py-10">
      <Header />
      <HistoryView {...props} />
    </main>
  );
}

function Header() {
  return (
    <header className="le-history-hd">
      <p className="le-history-eyebrow">Archive</p>
      <h1 className="le-history-title">League History</h1>
      <p className="le-history-sub">
        Every recorded SFBL season — champions, standings, and
        records — all the way back to 2003.
      </p>
    </header>
  );
}

// Sort key for season strings (Spring 2024 > Fall 2023 > …).
function seasonKey(s: string): number {
  const m = /^(\w+(?:\s\w+)?)\s*-\s*(\d{4})$/.exec(s);
  if (!m) return 0;
  const tier =
    m[1] === "Florida Cup" ? 1
    : m[1] === "Spring" ? 2
    : m[1] === "Summer" ? 3
    : m[1] === "Fall" ? 4
    : 0;
  return parseInt(m[2]!, 10) * 10 + tier;
}
