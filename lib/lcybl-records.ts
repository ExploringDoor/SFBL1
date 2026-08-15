// LCYBL Record Book — computed from the 2009-2025 archive JSON on disk
// (data/lcybl/champions.json + historical-standings.json). Server-only.
//
// Data hygiene (why this file is careful):
//   • historical-standings contains 8 EXACT duplicate tables (same division
//     listed under two names, e.g. "2017 14u-1" and "2017 14u-1 American")
//     and "combined" tables that re-list other tables' rows with an "X "
//     prefix ("14u Sec 2" = North + South rows). Naive summing double-counts.
//   • Fix: normalize names (strip the "X " marker), then keep ONE row per
//     (season, team) — the one with the most games played. A team plays one
//     regular season per year, so per-season-per-team is the true grain.
//   • Champions names arrive in mixed case ("HEMPFIELD BLACK" vs "Hempfield
//     Black") — normalized through the same title-caser with an acronym list.
//
// Computed once at module load (the archive is static); ~1ms per request after.

import fs from "node:fs";
import path from "node:path";

interface ChampionSeason {
  season: string;
  divisions: {
    division: string;
    team: string | null;
    runner_up: string | null;
    disputed?: boolean;
  }[];
}

interface StandingsTable {
  season: string;
  game_type: string;
  division: string;
  standings: { team: string; w: number; l: number; t?: number }[];
}

export interface TitleRow {
  team: string;
  count: number;
  titles: { season: string; division: string }[];
}

export interface SeasonRecordRow {
  team: string;
  season: string;
  division: string;
  w: number;
  l: number;
  t: number;
  pct: number;
}

export interface FranchiseRow {
  team: string;
  w: number;
  l: number;
  t: number;
  pct: number;
  seasons: number;
}

export interface RecordBook {
  seasonsCovered: { first: string; last: string; count: number };
  totalTitles: number;
  titles: TitleRow[];
  perfectSeasons: SeasonRecordRow[];
  bestSeasons: SeasonRecordRow[];
  allTimeWins: FranchiseRow[];
  backToBack: { team: string; division: string; seasons: string[] }[];
}

// Words that stay uppercase when title-casing team names.
const ACRONYMS = new Set([
  "LCYBL", "VFW", "CV", "LS", "MT", "PM", "PV", "X", "II", "III",
]);

function normalizeName(raw: string): string {
  let s = raw.trim().replace(/\s+/g, " ");
  // "X " prefix marks a re-listed row in a combined table — same team.
  if (/^x\s/i.test(s)) s = s.slice(2);
  // Title-case with acronym preservation. SOLANCO stays as written when
  // already mixed/upper beyond acronym length? Keep simple: word by word.
  const words = s.split(" ").map((w) => {
    const up = w.toUpperCase();
    if (ACRONYMS.has(up)) return up;
    // Preserve interior capitals like "McSherrystown"; only fix ALLCAPS/alllower.
    if (w === up || w === w.toLowerCase()) {
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    }
    return w;
  });
  return words.join(" ");
}

function pctOf(w: number, l: number, t: number): number {
  const gp = w + l + t;
  return gp > 0 ? (w + 0.5 * t) / gp : 0;
}

function dataPath(file: string): string {
  return path.resolve(process.cwd(), "data/lcybl", file);
}

function compute(): RecordBook {
  const champs = JSON.parse(
    fs.readFileSync(dataPath("champions.json"), "utf8"),
  ) as ChampionSeason[];
  const tables = JSON.parse(
    fs.readFileSync(dataPath("historical-standings.json"), "utf8"),
  ) as StandingsTable[];

  // ---- Titles ----
  const titleMap = new Map<string, { season: string; division: string }[]>();
  let totalTitles = 0;
  for (const season of champs) {
    for (const d of season.divisions) {
      if (!d.team) continue;
      totalTitles++;
      const name = normalizeName(d.team);
      if (!titleMap.has(name)) titleMap.set(name, []);
      titleMap.get(name)!.push({ season: season.season, division: d.division });
    }
  }
  const titles: TitleRow[] = [...titleMap.entries()]
    .map(([team, list]) => ({
      team,
      count: list.length,
      titles: list.sort((a, b) => b.season.localeCompare(a.season)),
    }))
    .sort((a, b) => b.count - a.count || a.team.localeCompare(b.team));

  // ---- Back-to-back champions (same team, same division, consecutive years) ----
  const byTeamDiv = new Map<string, Set<number>>();
  for (const season of champs) {
    const yr = Number(season.season);
    if (!yr) continue;
    for (const d of season.divisions) {
      if (!d.team) continue;
      // Group by team + age group (the leading token of the division, e.g.
      // "10u") so "10u Section 1" and "10u Section 1 Yellow" chain together.
      const age = (d.division.match(/^\d+u/i)?.[0] ?? d.division).toLowerCase();
      const key = `${normalizeName(d.team)}|${age}`;
      if (!byTeamDiv.has(key)) byTeamDiv.set(key, new Set());
      byTeamDiv.get(key)!.add(yr);
    }
  }
  const backToBack: RecordBook["backToBack"] = [];
  for (const [key, years] of byTeamDiv) {
    const sorted = [...years].sort((a, b) => a - b);
    let run: number[] = [];
    const flush = () => {
      if (run.length >= 2) {
        const [team, age] = key.split("|");
        backToBack.push({
          team: team!,
          division: age!.toUpperCase(),
          seasons: run.map(String),
        });
      }
      run = [];
    };
    for (const y of sorted) {
      if (run.length && y === run[run.length - 1]! + 1) run.push(y);
      else {
        flush();
        run = [y];
      }
    }
    flush();
  }
  backToBack.sort(
    (a, b) => b.seasons.length - a.seasons.length || a.team.localeCompare(b.team),
  );

  // ---- Per-(season, team) dedupe of standings rows ----
  const seasonTeam = new Map<
    string,
    { team: string; season: string; division: string; w: number; l: number; t: number }
  >();
  for (const tbl of tables) {
    if (tbl.game_type !== "season") continue;
    for (const row of tbl.standings) {
      const name = normalizeName(row.team);
      const key = `${tbl.season}|${name.toLowerCase()}`;
      const t = row.t ?? 0;
      const games = row.w + row.l + t;
      const cur = seasonTeam.get(key);
      const curGames = cur ? cur.w + cur.l + cur.t : -1;
      if (!cur || games > curGames) {
        seasonTeam.set(key, {
          team: name,
          season: tbl.season,
          division: tbl.division,
          w: row.w,
          l: row.l,
          t,
        });
      }
    }
  }

  // ---- Perfect + best seasons ----
  const seasonRows: SeasonRecordRow[] = [...seasonTeam.values()].map((r) => ({
    ...r,
    pct: pctOf(r.w, r.l, r.t),
  }));
  const MIN_GAMES = 12;
  const perfectSeasons = seasonRows
    .filter((r) => r.l === 0 && r.t === 0 && r.w >= MIN_GAMES)
    .sort((a, b) => b.w - a.w || b.season.localeCompare(a.season));
  const bestSeasons = seasonRows
    .filter((r) => r.w + r.l + r.t >= MIN_GAMES && r.l <= 1 && !(r.l === 0 && r.t === 0))
    .sort((a, b) => b.pct - a.pct || b.w - a.w || b.season.localeCompare(a.season))
    .slice(0, 12);

  // ---- All-time franchise wins ----
  const franchise = new Map<string, { w: number; l: number; t: number; seasons: Set<string> }>();
  for (const r of seasonTeam.values()) {
    const key = r.team;
    if (!franchise.has(key))
      franchise.set(key, { w: 0, l: 0, t: 0, seasons: new Set() });
    const f = franchise.get(key)!;
    f.w += r.w;
    f.l += r.l;
    f.t += r.t;
    f.seasons.add(r.season);
  }
  const allTimeWins: FranchiseRow[] = [...franchise.entries()]
    .map(([team, f]) => ({
      team,
      w: f.w,
      l: f.l,
      t: f.t,
      pct: pctOf(f.w, f.l, f.t),
      seasons: f.seasons.size,
    }))
    .sort((a, b) => b.w - a.w)
    .slice(0, 15);

  const seasons = [...new Set(champs.map((c) => c.season))].sort();
  return {
    seasonsCovered: {
      first: seasons[0] ?? "",
      last: seasons[seasons.length - 1] ?? "",
      count: seasons.length,
    },
    totalTitles,
    titles,
    perfectSeasons,
    bestSeasons,
    allTimeWins,
    backToBack,
  };
}

let cached: RecordBook | null = null;

export function getRecordBook(): RecordBook {
  if (!cached) cached = compute();
  return cached;
}
