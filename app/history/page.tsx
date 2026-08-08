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
  ArchivedGame,
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

/**
 * Champions a league publishes outright, from `data/{tenantId}/champions.json`.
 *
 * Shape on disk (records are deliberately absent — see the file's own note):
 *   [{ season: "2025",
 *      divisions: [{ division, team, runner_up, disputed? }] }]
 *
 * Absent file → empty array → the caller falls back to deriving champions from
 * standings, which is the behaviour every existing tenant keeps.
 */
function loadExplicitChampions(
  tenantId: string,
  nameIdx: Record<string, TeamMeta>,
): ChampionRow[] {
  const file = path.resolve(process.cwd(), `data/${tenantId}/champions.json`);
  if (!fs.existsSync(file)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as {
      season: string;
      divisions: {
        division: string;
        team: string;
        runner_up?: string | null;
        disputed?: boolean;
      }[];
    }[];
    const look = (name: string | null | undefined) =>
      name ? nameIdx[name.trim().toLowerCase()] ?? null : null;
    return raw
      .filter((r) => r && r.season && Array.isArray(r.divisions))
      .map((r) => ({
        season: String(r.season),
        divisions: r.divisions
          .filter((d) => d && d.team)
          .map((d) => ({
            division: String(d.division ?? ""),
            team: String(d.team),
            meta: look(d.team),
            runnerUp: d.runner_up ? String(d.runner_up) : null,
            runnerUpMeta: look(d.runner_up),
            ...(d.disputed ? { disputed: true } : {}),
          })),
      }))
      .filter((r) => r.divisions.length > 0)
      .sort((a, b) => seasonKey(b.season) - seasonKey(a.season));
  } catch {
    return [];
  }
}

/** Years that have a per-season bracket page, from the playoffs index the
 *  extraction pipeline writes. Absent file → no year links. */
function loadChampionSlides(tenantId: string): import("@/components/ChampionsSlideshow").ChampionSlide[] {
  const file = path.resolve(process.cwd(), `data/${tenantId}/champion-slides.json`);
  if (!fs.existsSync(file)) return [];
  try {
    const v = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function loadIndex(tenantId: string): { year: number }[] {
  const file = path.resolve(
    process.cwd(),
    `data/${tenantId}/playoffs/index.json`,
  );
  if (!fs.existsSync(file)) return [];
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as { year: number }[];
  } catch {
    return [];
  }
}

// Curated league-heritage facts (founding year + milestone counts).
// The standings ARCHIVE only goes back to the years we have data
// for; this lets the header state the real heritage (e.g. SFBL
// founded 1992) without fabricating pre-archive season blocks.
// Optional per tenant — absent file → no heritage line.
interface HistoryMeta {
  established?: number;
  years_in_operation?: number;
  season_count?: number;
}

// Games from seasons that have been cleared off the live site. Kept as a
// static file so the results stay browsable after the season rolls over.
function loadArchivedGames(
  tenantId: string,
): { season: string; games: ArchivedGame[] }[] {
  const out: { season: string; games: ArchivedGame[] }[] = [];
  const dir = path.resolve(process.cwd(), `data/${tenantId}`);
  if (!fs.existsSync(dir)) return out;
  for (const file of fs.readdirSync(dir)) {
    const m = /^season-games-(\d{4})\.json$/.exec(file);
    if (!m) continue;
    try {
      const games = JSON.parse(
        fs.readFileSync(path.join(dir, file), "utf8"),
      ) as ArchivedGame[];
      out.push({ season: m[1]!, games });
    } catch {
      /* a malformed archive file just does not appear */
    }
  }
  out.sort((a, b) => Number(b.season) - Number(a.season));
  return out;
}

function loadHistoryMeta(tenantId: string): HistoryMeta | null {
  const file = path.resolve(
    process.cwd(),
    `data/${tenantId}/history-meta.json`,
  );
  if (!fs.existsSync(file)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<
      string,
      unknown
    >;
    const num = (v: unknown) =>
      typeof v === "number" && Number.isFinite(v) ? v : undefined;
    return {
      established: num(raw.established),
      years_in_operation: num(raw.years_in_operation),
      season_count: num(raw.season_count),
    };
  } catch {
    return null;
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
  // Leagues that record a playoff bracket get true champions: the team that
  // came out of the bracket undefeated. Leagues that only record regular
  // season standings (COYBL) have no bracket to read, so the honour that
  // actually exists in their data is finishing first in a division. Fall
  // back to that rather than showing an empty page.
  const hasPlayoffs = all.some(
    (b) => b.game_type === "playoff" && b.standings.length > 0,
  );

  // Group by season → list of {division, team}.
  const bySeason = new Map<
    string,
    {
      division: string;
      team: string;
      record?: string;
      meta: TeamMeta | null;
    }[]
  >();
  for (const b of all) {
    if (hasPlayoffs ? b.game_type !== "playoff" : b.game_type !== "season") {
      continue;
    }
    if (b.standings.length === 0) continue;
    const top = b.standings[0]!;
    // Only count undefeated playoff teams as the bracket champion.
    // Sparse old-year data sometimes has a single round of W-L
    // recorded — flagging the top of that as champion is misleading.
    // A division winner, by contrast, can and usually does have losses.
    if (hasPlayoffs && top.l > 0) continue;
    // A division nobody actually played in shouldn't crown anyone.
    if (!hasPlayoffs && top.w + top.l + top.t === 0) continue;
    const meta = nameIdx[top.team.trim().toLowerCase()] ?? null;
    const arr = bySeason.get(b.season) ?? [];
    const record = top.t ? `${top.w}-${top.l}-${top.t}` : `${top.w}-${top.l}`;
    arr.push({ division: b.division, team: top.team, record, meta });
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
  // Grouped case-insensitively. An archive assembled from more than one kind of
  // source will spell the same club two ways — LCYBL's older seasons are typed
  // in Title Case while the later ones are transcribed from ALL-CAPS trophy
  // banners — and a case-sensitive key silently splits a six-time champion into
  // two three-time champions, understating the most decorated clubs.
  interface ChampTally {
    count: number;
    seasons: string[];
    display: Map<string, number>;
  }
  const counts = new Map<string, ChampTally>();
  for (const row of champions) {
    for (const d of row.divisions) {
      const raw = d.team.trim();
      if (!raw) continue;
      const key = raw.toLowerCase();
      // The fallback is annotated: an inline literal infers `seasons: never[]`,
      // which makes the push below a type error.
      const fresh: ChampTally = { count: 0, seasons: [], display: new Map() };
      const cur = counts.get(key) ?? fresh;
      cur.count += 1;
      cur.seasons.push(row.season);
      // Keep every spelling seen so the most common one can be displayed,
      // rather than whichever happened to be encountered first.
      cur.display.set(raw, (cur.display.get(raw) ?? 0) + 1);
      counts.set(key, cur);
    }
  }
  const rows: LeaderboardRow[] = [];
  for (const [key, c] of counts) {
    // Prefer the most-used spelling; break ties toward the one that is not
    // shouting, since ALL CAPS comes from banner artwork rather than from how
    // the league writes the name.
    const display = [...c.display.entries()].sort(
      (a, b) =>
        b[1] - a[1] ||
        Number(a[0] === a[0].toUpperCase()) - Number(b[0] === b[0].toUpperCase()) ||
        a[0].localeCompare(b[0]),
    )[0]![0];
    rows.push({
      team: display,
      meta: nameIdx[key] ?? null,
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

  const historyMeta = loadHistoryMeta(tenantId);
  const [all, teams] = await Promise.all([
    Promise.resolve(loadHistory(tenantId)),
    loadTeamMeta(tenantId),
  ]);

  if (all.length === 0) {
    // Empty-state header still wants tenant-aware copy.
    const leagueName = await loadLeagueName(tenantId);
    return (
      <main className="container py-10">
        <Header
          leagueName={leagueName}
          earliestYear={null}
          meta={historyMeta}
        />
        <div className="le-history-empty">
          <strong>League history is not available yet.</strong>
          <p>Once past seasons are archived, they'll appear here.</p>
        </div>
      </main>
    );
  }

  // Linking a historical team name to a CURRENT team doc only makes sense
  // where the franchise carries across seasons. COYBL rebuilds its teams from
  // scratch every year (coaches register fresh, and last season's team docs
  // are cleared), so any match is coincidence and the link would rot the
  // moment the season rolls over. No index means no logos and no links, just
  // the names as they were recorded.
  const teamsCarryAcrossSeasons = tenantId !== "coybl";
  const nameIdx = teamsCarryAcrossSeasons ? buildNameIndex(teams) : {};

  // A league whose archive STATES its champions (a printed bracket winner and
  // runner-up banner) beats deriving them from standings. Deriving would mean
  // inventing a playoff W-L row to satisfy the "undefeated top row" rule, and
  // there would be nowhere to record the beaten finalist at all.
  const explicit = loadExplicitChampions(tenantId, nameIdx);
  const champions = explicit.length > 0 ? explicit : deriveChampions(all, nameIdx);
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
    archivedGames: loadArchivedGames(tenantId),
    nameIdx,
    champions,
    championsLb,
    winsLb,
    // Seasons that have a full bracket page, so the Champions wall can link
    // each year through to it. Empty for tenants with no playoff archive.
    bracketYears: loadIndex(tenantId).map((r) => r.year),
    championSlides: loadChampionSlides(tenantId),
    // A tenant that ships a branded trophy image (public/<tenant>/trophy.png)
    // gets it on the Champions tab in place of the generic emoji. Absent for
    // every other tenant, which keeps the 🏆 fallback.
    trophyUrl: fs.existsSync(
      path.resolve(process.cwd(), `public/${tenantId}/trophy.png`),
    )
      ? `/${tenantId}/trophy.png`
      : undefined,
    // When a league records no playoff bracket, the top of each division is
    // a division winner, not a champion. Label it for what it is — unless the
    // league publishes its bracket winners outright, in which case they are
    // champions regardless of whether playoff STANDINGS were ever recorded.
    honourLabel:
      explicit.length > 0 ||
      all.some((b) => b.game_type === "playoff" && b.standings.length > 0)
        ? "champion"
        : "division-winner",
    stats: {
      seasonCount,
      oldestYear,
      totalChampionships,
      teamCount,
    },
  };

  // Compute the earliest year in the archive so the subtitle reads
  // "all the way back to 2003" for SFBL, "back to 2019" for LBDC,
  // etc. without us hardcoding it.
  const seasonYearsForSub = all
    .map((b) => /\b(20\d{2})\b/.exec(b.season)?.[1])
    .filter((y): y is string => !!y)
    .map((y) => parseInt(y, 10))
    .filter((n) => !Number.isNaN(n));
  const earliestYear = seasonYearsForSub.length
    ? Math.min(...seasonYearsForSub)
    : null;
  const leagueName = await loadLeagueName(tenantId);

  return (
    <main className="container py-10">
      <Header
        leagueName={leagueName}
        earliestYear={earliestYear}
        meta={historyMeta}
      />
      <HistoryView {...props} />
    </main>
  );
}

// Reads the tenant's display name (e.g. "Long Beach Diamond Classic")
// off the top-level league doc. Falls back to a generic phrase when
// the doc isn't readable. The header subtitle uses it for copy.
async function loadLeagueName(tenantId: string): Promise<string> {
  try {
    const db = getAdminDb();
    const snap = await db.doc(`leagues/${tenantId}`).get();
    if (!snap.exists) return "the league";
    const data = snap.data() ?? {};
    return String(data.name ?? data.abbrev ?? "the league");
  } catch {
    return "the league";
  }
}

// 1 → "1st", 2 → "2nd", 35 → "35th", 66 → "66th", 22 → "22nd".
function ordinal(n: number): string {
  const v = n % 100;
  const suffix =
    v >= 11 && v <= 13
      ? "th"
      : n % 10 === 1
        ? "st"
        : n % 10 === 2
          ? "nd"
          : n % 10 === 3
            ? "rd"
            : "th";
  return `${n}${suffix}`;
}

function Header({
  leagueName,
  earliestYear,
  meta,
}: {
  leagueName: string;
  earliestYear: number | null;
  meta?: HistoryMeta | null;
}) {
  const heritage: string[] = [];
  if (meta?.established) heritage.push(`Est. ${meta.established}`);
  if (meta?.years_in_operation)
    heritage.push(`${ordinal(meta.years_in_operation)} year`);
  if (meta?.season_count)
    heritage.push(`${ordinal(meta.season_count)} season`);
  return (
    <header className="le-history-hd">
      <p className="le-history-eyebrow">Archive</p>
      <h1 className="le-history-title">League History</h1>
      {heritage.length > 0 && (
        <p
          className="le-history-eyebrow"
          style={{
            color: "var(--brand-primary)",
            marginTop: 6,
            fontWeight: 700,
            letterSpacing: "0.04em",
          }}
        >
          {heritage.join("  ·  ")}
        </p>
      )}
      <p className="le-history-sub">
        Every recorded {leagueName} season — champions, standings, and
        records
        {earliestYear ? ` — all the way back to ${earliestYear}.` : "."}
      </p>
    </header>
  );
}

// Sort key for season strings (Spring 2024 > Fall 2023 > …). Accepts
// both single-word labels ("Spring") and slash-joined labels
// ("Spring/Summer") that LBDC's archive uses. Anything that
// doesn't match the canonical Label-Year shape gets tier 0 so it
// still sorts by year alongside its peers (just unstably within a
// year, which is acceptable for the long tail).
function seasonKey(s: string): number {
  const m = /^([A-Za-z][A-Za-z\/\s]*?)\s*-\s*(\d{4})$/.exec(s);
  if (!m) return 0;
  const label = m[1]!.trim();
  const tier =
    label === "Florida Cup" ? 1
    : label === "Spring" ? 2
    : label === "Spring/Summer" ? 2
    : label === "Summer" ? 3
    : label === "Fall" ? 4
    : label === "Fall/Winter" ? 4
    : label === "Winter" ? 5
    : label === "Season" ? 6
    : label === "Postseason" ? 7
    : 0;
  return parseInt(m[2]!, 10) * 10 + tier;
}
