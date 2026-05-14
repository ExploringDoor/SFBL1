// Transform LBDC historical-standings.json into the schema the app's
// /history page expects.
//
// LBDC source shape (raw export from their old site):
//   { name, divisionId, games, standings: [{team, w, l, t, pts, gb}] }
//
// App shape (app/history/types.ts → StandingsBlock):
//   { season: "Spring - 2024", game_type: "season"|"playoff",
//     division: "Saturday Division", standings: [{team, w, l, t, g, pct, p}] }
//
// Run:
//   npx tsx scripts/transform-lbdc-history.ts
//
// Overwrites both data/lbdc/ and data/lbdc-staging/ JSON files. Backup
// the originals to <file>.raw.json first so we don't lose the source
// shape if the transform classifies anything wrong.

import * as fs from "node:fs";
import * as path from "node:path";

interface RawRow {
  team: string;
  w: number;
  l: number;
  t: number;
  pts?: number;
  gb?: string | number;
}
interface RawBlock {
  name: string;
  divisionId?: string;
  games?: unknown[];
  rosters?: unknown[];
  standings: RawRow[];
}

interface OutRow {
  team: string;
  w: number;
  l: number;
  t: number;
  g: number;
  pct: string; // ".917"
  p: number; // points
}
interface OutBlock {
  season: string; // "Spring/Summer - 2026"
  game_type: "season" | "playoff";
  division: string;
  standings: OutRow[];
}

// Words that mark a block as a tournament / playoff event rather than
// a regular season. Anything matching → game_type = "playoff".
const PLAYOFF_HINTS = [
  /tournament/i,
  /world\s*series/i,
  /\bcup\b/i,
  /father\s*\/?\s*son/i,
  /memorial/i,
  /\bmlk\b/i,
  /4th\s*of\s*july/i,
  /\bturkey\s*bowl/i,
  /\bopen\b/i,
  /championship/i,
];

function isPlayoff(name: string): boolean {
  return PLAYOFF_HINTS.some((re) => re.test(name));
}

function pickYear(name: string): string {
  const m = name.match(/\b(20\d{2})\b/);
  return m ? m[1]! : "Unknown";
}

// Extract the season label (Spring/Summer, Fall/Winter, etc.) when
// present. Falls back to a contextual label so the /history page
// can still group/sort.
function pickSeasonLabel(name: string, gameType: "season" | "playoff"): string {
  if (/spring\s*\/?\s*summer/i.test(name)) return "Spring/Summer";
  if (/fall\s*\/?\s*winter/i.test(name)) return "Fall/Winter";
  if (/\bspring\b/i.test(name)) return "Spring";
  if (/\bsummer\b/i.test(name)) return "Summer";
  if (/\bfall\b/i.test(name)) return "Fall";
  if (/\bwinter\b/i.test(name)) return "Winter";
  return gameType === "playoff" ? "Postseason" : "Season";
}

// What's left after stripping year + season + boilerplate becomes the
// "division" descriptor. E.g. "Spring/Summer 2026 Diamond Classics
// Saturdays" → "Diamond Classics Saturdays".
function pickDivision(name: string): string {
  let s = name;
  s = s.replace(/\b20\d{2}\b/, "");
  s = s.replace(/spring\s*\/?\s*summer/i, "");
  s = s.replace(/fall\s*\/?\s*winter/i, "");
  s = s.replace(/\b(spring|summer|fall|winter)\b/i, "");
  s = s.replace(/\b(season|season\s*#?\s*\d+)\b/i, "");
  s = s.replace(/\s{2,}/g, " ").trim();
  return s || "Division";
}

function transformRow(r: RawRow): OutRow {
  const w = Number(r.w ?? 0);
  const l = Number(r.l ?? 0);
  const t = Number(r.t ?? 0);
  const g = w + l + t;
  // PCT — half-credit for ties (the standard baseball/softball
  // convention). 0 games → ".000" so we never divide by zero.
  const num = w + 0.5 * t;
  const den = g;
  const pctNum = den === 0 ? 0 : num / den;
  const pct = pctNum.toFixed(3).replace(/^0/, "");
  return {
    team: String(r.team),
    w,
    l,
    t,
    g,
    pct,
    p: Number(r.pts ?? 0),
  };
}

function transformBlock(b: RawBlock): OutBlock {
  const playoff = isPlayoff(b.name);
  const game_type: "season" | "playoff" = playoff ? "playoff" : "season";
  const year = pickYear(b.name);
  const label = pickSeasonLabel(b.name, game_type);
  return {
    season: `${label} - ${year}`,
    game_type,
    division: pickDivision(b.name),
    standings: (b.standings ?? []).map(transformRow),
  };
}

function processFile(file: string) {
  if (!fs.existsSync(file)) {
    console.log(`[skip] ${file} not found`);
    return;
  }
  const raw = fs.readFileSync(file, "utf8");
  const blocks = JSON.parse(raw) as RawBlock[];
  if (!Array.isArray(blocks)) {
    console.log(`[skip] ${file} is not a JSON array`);
    return;
  }
  // Heuristic: if the first block already has the target schema
  // (presence of `season` + `game_type`), don't double-transform.
  const first = blocks[0] as unknown as Partial<OutBlock> | undefined;
  if (first && typeof first.season === "string" && first.game_type) {
    console.log(`[skip] ${file} already in target schema`);
    return;
  }
  // Backup the raw file once. Never overwrite an existing backup.
  const backup = file.replace(/\.json$/, ".raw.json");
  if (!fs.existsSync(backup)) {
    fs.writeFileSync(backup, raw);
    console.log(`[backup] -> ${backup}`);
  }
  const out: OutBlock[] = blocks.map(transformBlock);
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`[write] ${file} (${out.length} blocks)`);
  // Sanity log: print the season/division/gametype for each block.
  for (const b of out) {
    console.log(
      `   ${b.game_type.padEnd(7)} ${b.season.padEnd(22)} ${b.division}`,
    );
  }
}

const CWD = process.cwd();
const targets = [
  path.resolve(CWD, "data/lbdc/historical-standings.json"),
  path.resolve(CWD, "data/lbdc-staging/historical-standings.json"),
];
for (const t of targets) processFile(t);
