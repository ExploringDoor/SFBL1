// Franchise history for a team page: every season it appears in the archive,
// its record that season, and the titles and runner-up finishes it collected.
//
// Why this exists alongside the team page's existing `countChampionships`:
// that helper counts blocks with `game_type: "playoff"` whose top row is
// undefeated. A league that publishes a printed champion banner rather than
// playoff standings (LCYBL) has NO playoff blocks at all, so it counted zero
// titles for every team while `champions.json` listed a hundred and eighteen.
//
// Names are matched case-insensitively. An archive assembled from more than one
// source spells the same club two ways — LCYBL's older seasons are typed in
// Title Case and its later ones transcribed from ALL-CAPS trophy banners — so a
// case-sensitive match silently halves a franchise's history.
//
// Pure: callers pass the parsed archives in.

export interface ArchiveStandingRow {
  team: string;
  w: number;
  l: number;
  t: number;
  g?: number;
  pct?: string;
  p?: number;
}

export interface ArchiveBlock {
  season: string;
  game_type?: string;
  division: string;
  standings: ArchiveStandingRow[];
}

export interface ChampionsFile {
  season: string;
  divisions: {
    division: string;
    team: string;
    runner_up?: string | null;
    disputed?: boolean;
  }[];
}

export interface SeasonLine {
  season: string;
  division: string;
  w: number;
  l: number;
  t: number;
  /** Where they finished in that division's table, 1-based. */
  place: number;
  outOf: number;
  champion: boolean;
  runnerUp: boolean;
  disputed: boolean;
}

export interface TeamHistory {
  seasons: SeasonLine[];
  titles: { season: string; division: string; disputed: boolean }[];
  runnerUps: { season: string; division: string }[];
  totals: { w: number; l: number; t: number; seasons: number; pct: string };
}

/** One archived game as extracted from the league's playoff PDFs. The
 *  away/home keys are READING ORDER, not actual home/away, whenever
 *  `orientation_known` is false — display must say "vs", never "at". */
export interface ArchivedGame {
  date?: string | null;
  ageGroup?: string | null;
  division?: string | null;
  away: string;
  home: string;
  away_score?: number | null;
  home_score?: number | null;
  orientation_known?: boolean;
}

export interface GameLogLine {
  season: string;
  division: string;
  /** The opponent's name as printed in the archive. */
  opponent: string;
  /** This team's runs / the opponent's runs. */
  scored: number;
  allowed: number;
  result: "W" | "L" | "T";
}

/** Per-season archived playoff games for one team, newest season first.
 *  Games without both scores are skipped — a bracket slot with no printed
 *  score describes a matchup, not a result. Matching is case-insensitive
 *  (same reason as buildTeamHistory: the archive mixes Title Case and
 *  ALL-CAPS spellings of the same club). */
export function buildTeamGameLog(
  teamName: string,
  gamesBySeason: Record<string, ArchivedGame[]>,
): Map<string, GameLogLine[]> {
  const want = norm(teamName);
  const out = new Map<string, GameLogLine[]>();
  const seasons = Object.keys(gamesBySeason).sort((a, b) => b.localeCompare(a));
  for (const season of seasons) {
    const games = gamesBySeason[season];
    if (!Array.isArray(games)) continue;
    const lines: GameLogLine[] = [];
    for (const g of games) {
      if (!g) continue;
      const isAway = norm(g.away) === want;
      const isHome = norm(g.home) === want;
      if (!isAway && !isHome) continue;
      if (
        typeof g.away_score !== "number" ||
        typeof g.home_score !== "number"
      ) {
        continue;
      }
      const scored = isAway ? g.away_score : g.home_score;
      const allowed = isAway ? g.home_score : g.away_score;
      lines.push({
        season,
        division: String(g.division ?? g.ageGroup ?? ""),
        opponent: isAway ? String(g.home) : String(g.away),
        scored,
        allowed,
        result: scored > allowed ? "W" : scored < allowed ? "L" : "T",
      });
    }
    if (lines.length) out.set(season, lines);
  }
  return out;
}

const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();

function pct(w: number, l: number, t: number): string {
  const g = w + l + t;
  if (!g) return ".000";
  return ((w + t / 2) / g).toFixed(3).replace(/^0/, "");
}

/** Build one team's franchise history. Returns empty arrays when the team does
 *  not appear in the archive, which is correct for a club founded recently. */
export function buildTeamHistory(
  teamName: string,
  archive: ArchiveBlock[],
  champions: ChampionsFile[],
): TeamHistory {
  const want = norm(teamName);
  const seasons: SeasonLine[] = [];

  // Titles first, so a season line can be marked as a championship season.
  const titles: TeamHistory["titles"] = [];
  const runnerUps: TeamHistory["runnerUps"] = [];
  for (const row of Array.isArray(champions) ? champions : []) {
    if (!row || !Array.isArray(row.divisions)) continue;
    for (const d of row.divisions) {
      if (!d) continue;
      if (norm(d.team) === want) {
        titles.push({
          season: String(row.season),
          division: String(d.division ?? ""),
          disputed: !!d.disputed,
        });
      }
      if (d.runner_up && norm(d.runner_up) === want) {
        runnerUps.push({
          season: String(row.season),
          division: String(d.division ?? ""),
        });
      }
    }
  }
  const titleKey = new Set(titles.map((t) => `${t.season}|${norm(t.division)}`));
  const runnerKey = new Set(
    runnerUps.map((r) => `${r.season}|${norm(r.division)}`),
  );
  const disputedKey = new Set(
    titles.filter((t) => t.disputed).map((t) => `${t.season}|${norm(t.division)}`),
  );

  for (const block of Array.isArray(archive) ? archive : []) {
    if (!block || !Array.isArray(block.standings)) continue;
    // Only regular-season tables describe a record. A playoff block, where one
    // exists, is a bracket result and would double-count.
    if (block.game_type && block.game_type !== "season") continue;
    const idx = block.standings.findIndex((r) => r && norm(r.team) === want);
    if (idx < 0) continue;
    const r = block.standings[idx]!;
    const key = `${block.season}|${norm(block.division)}`;
    seasons.push({
      season: String(block.season),
      division: String(block.division ?? ""),
      w: Number(r.w) || 0,
      l: Number(r.l) || 0,
      t: Number(r.t) || 0,
      place: idx + 1,
      outOf: block.standings.length,
      champion: titleKey.has(key),
      runnerUp: runnerKey.has(key),
      disputed: disputedKey.has(key),
    });
  }

  // Newest first — a visitor wants this season, then last season.
  seasons.sort((a, b) => b.season.localeCompare(a.season));
  titles.sort((a, b) => b.season.localeCompare(a.season));
  runnerUps.sort((a, b) => b.season.localeCompare(a.season));

  const w = seasons.reduce((n, s) => n + s.w, 0);
  const l = seasons.reduce((n, s) => n + s.l, 0);
  const t = seasons.reduce((n, s) => n + s.t, 0);

  return {
    seasons,
    titles,
    runnerUps,
    totals: {
      w,
      l,
      t,
      seasons: new Set(seasons.map((s) => s.season)).size,
      pct: pct(w, l, t),
    },
  };
}
