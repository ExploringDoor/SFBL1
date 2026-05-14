// scripts/transform-lbdc.ts — Phase 1.5 of the LBDC migration.
//
// Reads raw Supabase dumps from data/lbdc/raw/ and writes Firestore-
// shape JSON to data/lbdc/firestore/. NO Firestore writes — purely
// local file transform.
//
// Decisions baked in (per Adam, 2026-05-13):
//   - Team display names preserved with original capitalization +
//     spaces ("Black Sox"). URL slugs lowercased + hyphenated
//     ("black-sox").
//   - Two Postgres season rows id=2 + id=31 both labeled
//     "Spring/Summer 2026" merge into one logical season
//     "spring-summer-2026". Games on either row redirect to the
//     merged season.
//   - Tournament games (separate `tournament_games` table) live in
//     `/leagues/lbdc/tournament_games/{id}` — NOT mixed into the
//     regular `/games` collection.
//   - Playoff games (`status="Playoff"`) flatten to `status:"final"`
//     PLUS `is_playoff: true` so standings code can easily exclude
//     them from regular-season W/L.
//   - Statuses normalize:
//       Final, F, F*     → "final"
//       FFT              → "final" + `forfeit: true`
//       Playoff          → "final" + `is_playoff: true`
//       PPD              → "postponed"
//       Scheduled        → "scheduled"
//   - Names cleaned via cleanName() (NBSP + Unicode whitespace).
//   - "*" suffix stripped via matchKey() for the player_id slug,
//     preserved on the player's display name.
//   - Headlines stripped of " [submitted: TEAM]" via cleanHeadline().
//
// Outputs:
//   data/lbdc/firestore/
//     teams/<slug>.json          — one file per team
//     players/<id>.json          — one file per unique player
//     games/<id>.json            — regular-season + playoff games
//     tournament_games/<id>.json
//     news/<id>.json
//     photos/<id>.json
//     payments/<id>.json
//     availability/<id>.json
//     signups/<id>.json
//     seasons/<id>.json
//     _config/<id>.json          — singleton config docs (alert,
//                                  contact, divisions, fields,
//                                  rules, sponsors, tournaments,
//                                  page_content)
//     _manifest.json             — counts + warnings

import * as fs from "node:fs";
import * as path from "node:path";

// ── helpers ─────────────────────────────────────────────────────────

// LBDC's cleanName from src/App.jsx line 64. Strip all Unicode
// separator chars (NBSP, narrow nbsp, ideographic, etc.), collapse
// whitespace, trim.
function cleanName(n: unknown): string {
  return String(n ?? "")
    .replace(/\p{Z}/gu, " ")
    .replace(/\s+/g, " ")
    .replace(/\$+$/, "") // Pirates name quirk: trailing $
    .trim();
}

// matchKey from src/App.jsx — the dedup key. Strip "*" under-21
// suffix, lowercase. NOT the display name.
function matchKey(n: unknown): string {
  return cleanName(n)
    .replace(/\*+\s*$/, "")
    .toLowerCase()
    .trim();
}

// Web slug. Lowercase, alphanumeric + hyphens. Strip apostrophes
// (Greg Maddux Magicians '66 → greg-maddux-magicians-66).
function toSlug(s: string): string {
  return cleanName(s)
    .toLowerCase()
    .replace(/['']/g, "") // smart + straight apostrophes
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

// Headline cleaner — LBDC tags captain submissions with
// " [submitted: TEAM]". Strip for public display.
function cleanHeadline(h: unknown): string {
  return String(h ?? "")
    .replace(/\s*\[submitted:[^\]]*\]/gi, "")
    .trim();
}

// "8:00am" / "08:00 AM" / "8:00 am" → "08:00" (24h). Fallback to
// the original on parse failure so we don't drop the field.
function normalizeTime(t: unknown): string {
  const raw = String(t ?? "").trim();
  if (!raw) return "";
  const m = /^(\d{1,2})(?::(\d{2}))?\s*([ap])m?\s*$/i.exec(raw);
  if (!m) {
    // Already 24h or unrecognized — pass through.
    return raw;
  }
  let h = parseInt(m[1]!, 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  const ampm = m[3]!.toLowerCase();
  if (ampm === "p" && h !== 12) h += 12;
  if (ampm === "a" && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function normalizeStatus(raw: unknown): {
  status: "final" | "scheduled" | "postponed" | "cancelled";
  is_playoff: boolean;
  forfeit: boolean;
} {
  const s = String(raw ?? "").trim();
  if (s === "Playoff")
    return { status: "final", is_playoff: true, forfeit: false };
  if (s === "FFT")
    return { status: "final", is_playoff: false, forfeit: true };
  if (s === "Final" || s === "F" || s === "F*")
    return { status: "final", is_playoff: false, forfeit: false };
  if (s === "PPD")
    return { status: "postponed", is_playoff: false, forfeit: false };
  if (s === "CAN")
    return { status: "cancelled", is_playoff: false, forfeit: false };
  if (s === "Scheduled" || s === "")
    return { status: "scheduled", is_playoff: false, forfeit: false };
  // Anything we don't recognize — treat as scheduled and warn.
  return { status: "scheduled", is_playoff: false, forfeit: false };
}

// ── filesystem setup ────────────────────────────────────────────────

const RAW_DIR = path.resolve(process.cwd(), "data/lbdc/raw");
const OUT_DIR = path.resolve(process.cwd(), "data/lbdc/firestore");

function readRaw<T = Record<string, unknown>>(name: string): T[] {
  const p = path.join(RAW_DIR, `${name}.json`);
  if (!fs.existsSync(p)) return [];
  return JSON.parse(fs.readFileSync(p, "utf8")) as T[];
}

function writeDocs<T>(
  collection: string,
  docs: Array<{ id: string; data: T }>,
): void {
  const dir = path.join(OUT_DIR, collection);
  fs.mkdirSync(dir, { recursive: true });
  for (const d of docs) {
    // Sanitize the id so it's a valid Firestore doc id + filesystem
    // path component.
    const safeId = String(d.id).replace(/[\/\\]/g, "_") || "unknown";
    fs.writeFileSync(
      path.join(dir, `${safeId}.json`),
      JSON.stringify(d.data, null, 2) + "\n",
    );
  }
}

// ── season merge map ────────────────────────────────────────────────
// PLATFORM_MIGRATION.md §1: id=2 and id=31 both treated as
// "Spring/Summer 2026" Saturday. Build a name → canonical-slug map
// for every season the dump contains.

interface SeasonRaw {
  id: number;
  name: string;
  short_name?: string | null;
  year?: number | null;
  season_type?: string | null;
  start_date?: string | null;
  end_date?: string | null;
}

interface SeasonOut {
  id: string;
  name: string;
  short_name: string | null;
  year: number | null;
  season_type: string | null;
  start_date: string | null;
  end_date: string | null;
  source_ids: number[]; // original Postgres ids that merged into this
}

function buildSeasons(seasons: SeasonRaw[]): {
  out: Map<string, SeasonOut>;
  pgToSlug: Map<number, string>;
} {
  // Group by canonical name. The merge rule per Todd's doc:
  // "Spring/Summer 2026" + "Spring/Summer 2026 Diamond Classics
  // Saturdays" merge. Use a normalized prefix match — strip the
  // optional " Diamond Classics …" suffix.
  function canonicalName(name: string): string {
    return name
      .replace(/\s+Diamond Classics.*$/i, "")
      .trim();
  }
  const groups = new Map<string, SeasonRaw[]>();
  for (const s of seasons) {
    const key = canonicalName(s.name);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(s);
  }
  const out = new Map<string, SeasonOut>();
  const pgToSlug = new Map<number, string>();
  for (const [name, members] of groups) {
    // Pick the longest-name member as the display row (it's the more
    // descriptive variant; the other is a shorter alias).
    const display = [...members].sort(
      (a, b) => b.name.length - a.name.length,
    )[0]!;
    const slug = toSlug(name);
    out.set(slug, {
      id: slug,
      name,
      short_name: display.short_name ?? null,
      year: display.year ?? null,
      season_type: display.season_type ?? null,
      start_date: display.start_date ?? null,
      end_date: display.end_date ?? null,
      source_ids: members.map((m) => m.id),
    });
    for (const m of members) pgToSlug.set(m.id, slug);
  }
  return { out, pgToSlug };
}

// ── teams ───────────────────────────────────────────────────────────

interface RosterRow {
  id: number;
  team: string;
  name: string;
  number?: string | null;
  status?: string | null;
}

interface TeamOut {
  id: string;
  name: string;
  abbrev?: string;
  // Set later if we recognize the team as Saturday vs Boomers vs
  // tournament-only — left blank in this pass so admin can finalize.
  division: string | null;
  // color/logo come from lbdc_divisions or hardcoded constants in
  // App.jsx — populated in a follow-up using the LBDC source code.
  color?: string;
  logo_url?: string | null;
  source: "lbdc_rosters" | "games";
}

function buildTeams(
  rosters: RosterRow[],
  games: GameRaw[],
  tournGames: TournRaw[],
): Map<string, TeamOut> {
  const teams = new Map<string, TeamOut>();
  function add(displayName: string, source: TeamOut["source"]) {
    const cleaned = cleanName(displayName);
    if (!cleaned) return;
    // Drop the "Test" team — explicitly filtered in App.jsx
    // captain-team dropdown (line 9211).
    if (cleaned.toLowerCase() === "test") return;
    const slug = toSlug(cleaned);
    if (!slug) return;
    if (!teams.has(slug)) {
      teams.set(slug, {
        id: slug,
        name: cleaned,
        division: null,
        source,
      });
    }
  }
  for (const r of rosters) if (r.team) add(r.team, "lbdc_rosters");
  for (const g of games) {
    if (g.away_team) add(g.away_team, "games");
    if (g.home_team) add(g.home_team, "games");
  }
  for (const g of tournGames) {
    if (g.away_team) add(g.away_team, "games");
    if (g.home_team) add(g.home_team, "games");
  }
  return teams;
}

// ── players ─────────────────────────────────────────────────────────
// Build the canonical player list from lbdc_rosters. Each unique
// (team, matchKey(name)) pair is one player doc. Preserve the
// starred display name if EITHER captain entered the star (per
// preferStarred() in App.jsx).

interface PlayerOut {
  id: string;
  name: string;
  team_id: string;
  number: string | null;
  status: "active" | "dl" | "released" | "unknown";
  under_21: boolean;
  source_rows: number[];
}

function buildPlayers(
  rosters: RosterRow[],
  teams: Map<string, TeamOut>,
): {
  players: Map<string, PlayerOut>;
  nameToId: Map<string, string>;
} {
  const players = new Map<string, PlayerOut>();
  // For name → player_id resolution from batting/pitching lines later,
  // key is `${teamSlug}|${matchKey(name)}`. Most box-score rows have
  // a team_name field too so we can disambiguate Smiths.
  const nameToId = new Map<string, string>();
  for (const r of rosters) {
    if (!r.name || !r.team) continue;
    const teamSlug = toSlug(cleanName(r.team));
    if (!teams.has(teamSlug)) continue;
    const cleaned = cleanName(r.name);
    if (!cleaned) continue;
    const mk = matchKey(r.name);
    if (!mk) continue;
    // Player id: `<teamSlug>__<name-slug>` so two "John Smith"s on
    // different teams stay distinct.
    const nameSlug = toSlug(mk);
    const playerId = `${teamSlug}__${nameSlug}`;
    const starred = /\*\s*$/.test(cleaned);
    const existing = players.get(playerId);
    if (existing) {
      existing.source_rows.push(r.id);
      // preferStarred: if either row had the star, keep the starred
      // display name.
      if (starred && !/\*\s*$/.test(existing.name)) {
        existing.name = cleaned;
        existing.under_21 = true;
      }
      // Most-recent non-null status wins.
      if (r.status) existing.status = mapStatus(r.status);
      // Most-recent jersey wins.
      if (r.number) existing.number = String(r.number);
    } else {
      players.set(playerId, {
        id: playerId,
        name: cleaned,
        team_id: teamSlug,
        number: r.number ? String(r.number) : null,
        status: r.status ? mapStatus(r.status) : "unknown",
        under_21: starred,
        source_rows: [r.id],
      });
    }
    // nameToId lookup key for box-score line linking. Also include a
    // team-agnostic lookup as fallback (last write wins, but better
    // than nothing for orphan lines).
    nameToId.set(`${teamSlug}|${mk}`, playerId);
    if (!nameToId.has(`|${mk}`)) nameToId.set(`|${mk}`, playerId);
  }
  return { players, nameToId };
}

function mapStatus(s: string): PlayerOut["status"] {
  const v = s.toLowerCase().trim();
  if (v === "active") return "active";
  if (v === "dl") return "dl";
  if (v === "released") return "released";
  return "unknown";
}

// ── games ───────────────────────────────────────────────────────────

interface GameRaw {
  id: number;
  season_id: number;
  game_date: string | null;
  game_time: string | null;
  field: string | null;
  away_team: string;
  home_team: string;
  away_score: number | null;
  home_score: number | null;
  status: string | null;
  headline: string | null;
  ll_game_id?: string | null;
  innings?: Record<string, unknown> | null;
  created_at?: string;
}

interface GameOut {
  id: string;
  date: string;
  time: string;
  field: string | null;
  away_team_id: string;
  home_team_id: string;
  away_score: number;
  home_score: number;
  status: "final" | "scheduled" | "postponed" | "cancelled";
  is_playoff: boolean;
  forfeit: boolean;
  headline: string;
  season_id: string | null;
  innings: Record<string, unknown>;
  source_id: number;
  source_ll_game_id: string | null;
}

// Postgres season ids that count as "live" — included in the
// public /games collection so standings/scores/schedule render
// only the current league(s). Everything else (historical seasons,
// NABA / Memorial Weekend / Father-Son tournaments, archived
// fall/winter seasons from prior years) is excluded. They still
// land in data/lbdc/historical-standings.json for the /history
// page, and tournament_games keeps its own collection.
//
// Current set (per Adam, 2026-05-13):
//   id=2  Spring/Summer 2026          (Saturday primary, started 4/11)
//   id=28 2026 BOOMERS 60/70 Division (Boomers parallel, started 4/11)
//   id=31 Spring/Summer 2026 Diamond Classics Saturdays (alias of id=2)
//
// Fall/Winter (id=36) is intentionally excluded — those games shouldn't
// surface in the "current schedule" / "standings" / "ticker" view.
// Their data lives in historical-standings.json instead. Add id=36
// back here when the fall season actually starts.
const LBDC_LIVE_SEASON_IDS = new Set<number>([2, 28, 31]);

// Hard date floor — drops any game dated before the 2026 season
// opener (2026-04-11). Catches stragglers tagged with the current
// season_id but actually belonging to a pre-season or rescheduled
// older game.
const LBDC_LIVE_DATE_FLOOR = "2026-04-11";

function buildGames(
  games: GameRaw[],
  pgSeasonToSlug: Map<number, string>,
  teams: Map<string, TeamOut>,
  warnings: string[],
): GameOut[] {
  const out: GameOut[] = [];
  for (const g of games) {
    // Drop any game whose season isn't in the live set. Their data
    // sits in historical-standings.json instead, which the future
    // /history page reads.
    if (!LBDC_LIVE_SEASON_IDS.has(g.season_id)) continue;
    // Date floor — drops pre-season / off-by-one season tags.
    if (g.game_date && g.game_date < LBDC_LIVE_DATE_FLOOR) continue;
    const awaySlug = toSlug(cleanName(g.away_team));
    const homeSlug = toSlug(cleanName(g.home_team));
    if (!teams.has(awaySlug)) {
      warnings.push(
        `game ${g.id}: unknown away_team "${g.away_team}" (slug "${awaySlug}")`,
      );
    }
    if (!teams.has(homeSlug)) {
      warnings.push(
        `game ${g.id}: unknown home_team "${g.home_team}" (slug "${homeSlug}")`,
      );
    }
    const n = normalizeStatus(g.status);
    out.push({
      id: String(g.id),
      date: g.game_date ?? "",
      time: normalizeTime(g.game_time),
      field: g.field ?? null,
      away_team_id: awaySlug,
      home_team_id: homeSlug,
      away_score: g.away_score == null ? 0 : Number(g.away_score),
      home_score: g.home_score == null ? 0 : Number(g.home_score),
      status: n.status,
      is_playoff: n.is_playoff,
      forfeit: n.forfeit,
      headline: cleanHeadline(g.headline),
      season_id: pgSeasonToSlug.get(g.season_id) ?? null,
      innings: g.innings ?? {},
      source_id: g.id,
      source_ll_game_id: g.ll_game_id ?? null,
    });
  }
  return out;
}

interface TournRaw {
  id: number;
  tournament_name: string;
  game_date: string | null;
  game_time: string | null;
  field: string | null;
  away_team: string;
  home_team: string;
  notes?: string | null;
}

interface TournGameOut {
  id: string;
  tournament_name: string;
  date: string;
  time: string;
  field: string | null;
  away_team_id: string;
  home_team_id: string;
  notes: string;
  source_id: number;
}

function buildTournamentGames(
  rows: TournRaw[],
  teams: Map<string, TeamOut>,
  warnings: string[],
): TournGameOut[] {
  const out: TournGameOut[] = [];
  for (const r of rows) {
    const awaySlug = toSlug(cleanName(r.away_team));
    const homeSlug = toSlug(cleanName(r.home_team));
    if (!teams.has(awaySlug)) {
      warnings.push(
        `tournament_game ${r.id}: unknown away_team "${r.away_team}"`,
      );
    }
    if (!teams.has(homeSlug)) {
      warnings.push(
        `tournament_game ${r.id}: unknown home_team "${r.home_team}"`,
      );
    }
    out.push({
      id: String(r.id),
      tournament_name: r.tournament_name,
      date: r.game_date ?? "",
      time: normalizeTime(r.game_time),
      field: r.field ?? null,
      away_team_id: awaySlug,
      home_team_id: homeSlug,
      notes: r.notes ?? "",
      source_id: r.id,
    });
  }
  return out;
}

// ── box scores ──────────────────────────────────────────────────────
// LBDC stores per-line rows in batting_lines + pitching_lines. The
// leagueplatform model keeps the entire box score for one game as a
// single doc at /leagues/{id}/box_scores/{gameId} with
// away_lineup/home_lineup/away_pitchers/home_pitchers arrays.
//
// LBDC → leagueplatform field renames:
//   k          → so          (strikeouts)
//   ip "5.2"   → ip_outs 17   (baseball IP encoding: 5 innings + 2 outs)
//   team       → resolves to away or home side via game lookup
//
// Player linking: LBDC stores player_id as NULL (they never bound it
// — name + team is the identity key). We resolve via the nameToId
// map produced by buildPlayers(), team-scoped first, then a generic
// matchKey fallback. Unmatched lines record the player_name and
// player_id="" — the seeder can decide whether to create an orphan
// player doc.

interface BattingLineRaw {
  id: number;
  game_id: number;
  player_name: string;
  team: string;
  ab?: number; r?: number; h?: number; rbi?: number; bb?: number; k?: number;
  doubles?: number; triples?: number; hr?: number; sb?: number;
  hbp?: number; sf?: number; sac?: number; fc?: number; roe?: number; cs?: number;
  slot?: string | number | null;
  pos?: string | null;
}

interface PitchingLineRaw {
  id: number;
  game_id: number;
  player_name: string;
  team: string;
  ip?: number | string;
  h?: number; r?: number; er?: number; bb?: number; k?: number;
  decision?: string | null;
}

interface BoxBatterOut {
  player_id: string;
  player_name: string;
  slot: string | null;
  pos: string | null;
  ab: number;
  r: number;
  h: number;
  doubles: number;
  triples: number;
  hr: number;
  rbi: number;
  bb: number;
  so: number;
  sb: number;
  // Extended LBDC fields (lossless retention so we don't drop info).
  hbp: number;
  sf: number;
  sac: number;
  fc: number;
  roe: number;
  cs: number;
  source_line_id: number;
}

interface BoxPitcherOut {
  player_id: string;
  player_name: string;
  ip_outs: number;
  h: number;
  r: number;
  er: number;
  bb: number;
  so: number;
  decision: "W" | "L" | "S" | null;
  source_line_id: number;
}

interface BoxScoreOut {
  game_id: string;
  away_lineup: BoxBatterOut[];
  home_lineup: BoxBatterOut[];
  away_pitchers: BoxPitcherOut[];
  home_pitchers: BoxPitcherOut[];
  linescore: { away: number[]; home: number[] };
  hits: { away: number | null; home: number | null };
  errors: { away: number | null; home: number | null };
}

// LBDC baseball IP encoding: "5.2" means 5 innings + 2 outs = 17
// outs total. ".3"/".7" exists in legacy data as decimal corruption
// (see PLATFORM_MIGRATION.md §14). We tolerate but don't try to
// "fix" — leave as-is via best-effort coercion.
function ipToOuts(raw: unknown): number {
  if (raw == null || raw === "") return 0;
  const v = String(raw).trim();
  if (!v) return 0;
  const [whole, fracStr] = v.split(".");
  const innings = parseInt(whole ?? "0", 10) || 0;
  let outs = 0;
  if (fracStr != null) {
    const f = parseInt(fracStr, 10);
    if (f === 1 || f === 2) outs = f;
    // Decimal corruption (.3, .7, etc.) → drop the fraction. The
    // counts are off in legacy data anyway and we'd rather under-
    // report than over-claim. Flagged in PLATFORM_MIGRATION.md §14.
  }
  return innings * 3 + outs;
}

// Drop a batting line that's all zeros (and no slot/pos meaningful) —
// matches LBDC's save-time + load-time filter (PLATFORM_MIGRATION.md
// §3 "Zero-stat filter"). Keeps the canonical box score from being
// polluted by phantom rows.
function isEmptyBattingLine(r: BattingLineRaw): boolean {
  const counts = [
    r.ab, r.r, r.h, r.doubles, r.triples, r.hr, r.rbi, r.bb,
    r.k, r.sb, r.hbp, r.sf, r.sac, r.fc, r.roe, r.cs,
  ];
  if (counts.some((v) => Number(v) > 0)) return false;
  if (r.slot && String(r.slot).trim()) return false;
  if (r.pos && String(r.pos).trim()) return false;
  return true;
}

function isEmptyPitchingLine(r: PitchingLineRaw): boolean {
  if (Number(r.ip) > 0) return false;
  if (Number(r.h) > 0 || Number(r.r) > 0 || Number(r.er) > 0) return false;
  if (Number(r.bb) > 0 || Number(r.k) > 0) return false;
  if (r.decision) return false;
  return true;
}

function resolvePlayerId(
  nameToId: Map<string, string>,
  teamSlug: string,
  playerName: string,
): { id: string; resolved: boolean } {
  const mk = matchKey(playerName);
  if (!mk) return { id: "", resolved: false };
  const teamKey = `${teamSlug}|${mk}`;
  if (nameToId.has(teamKey)) return { id: nameToId.get(teamKey)!, resolved: true };
  const fallback = nameToId.get(`|${mk}`);
  if (fallback) return { id: fallback, resolved: true };
  // No match. Synthesize an orphan id so the line still has a
  // stable key, but flag as unresolved so the manifest counts.
  return {
    id: `orphan__${teamSlug || "?"}__${toSlug(mk)}`,
    resolved: false,
  };
}

interface OrphanPlayer {
  id: string;
  team_id: string;
  player_name: string;
  appearances: number; // how many lines reference this orphan
}

function buildBoxScores(
  battingLines: BattingLineRaw[],
  pitchingLines: PitchingLineRaw[],
  games: GameOut[],
  nameToId: Map<string, string>,
  warnings: string[],
): {
  boxes: BoxScoreOut[];
  unresolvedNames: number;
  orphans: Map<string, OrphanPlayer>;
} {
  const orphans = new Map<string, OrphanPlayer>();
  function bumpOrphan(
    id: string,
    teamSlug: string,
    playerName: string,
  ) {
    const cur = orphans.get(id);
    if (cur) {
      cur.appearances++;
    } else {
      orphans.set(id, {
        id,
        team_id: teamSlug,
        player_name: cleanName(playerName),
        appearances: 1,
      });
    }
  }
  // Index games by source_id so the line's game_id (int) finds the
  // canonical leagueplatform game doc.
  const gameById = new Map<number, GameOut>();
  for (const g of games) gameById.set(g.source_id, g);

  // Bucket lines by game.
  const battingByGame = new Map<number, BattingLineRaw[]>();
  for (const r of battingLines) {
    if (!battingByGame.has(r.game_id)) battingByGame.set(r.game_id, []);
    battingByGame.get(r.game_id)!.push(r);
  }
  const pitchingByGame = new Map<number, PitchingLineRaw[]>();
  for (const r of pitchingLines) {
    if (!pitchingByGame.has(r.game_id)) pitchingByGame.set(r.game_id, []);
    pitchingByGame.get(r.game_id)!.push(r);
  }

  const gameIds = new Set<number>([
    ...battingByGame.keys(),
    ...pitchingByGame.keys(),
  ]);

  const boxes: BoxScoreOut[] = [];
  let unresolvedNames = 0;

  for (const gameId of gameIds) {
    const game = gameById.get(gameId);
    if (!game) {
      warnings.push(
        `box_score: game_id=${gameId} referenced by lines but no game row — skipping ${
          (battingByGame.get(gameId)?.length ?? 0) +
          (pitchingByGame.get(gameId)?.length ?? 0)
        } lines`,
      );
      continue;
    }

    const battingRaw = (battingByGame.get(gameId) ?? []).filter(
      (r) => !isEmptyBattingLine(r),
    );
    const pitchingRaw = (pitchingByGame.get(gameId) ?? []).filter(
      (r) => !isEmptyPitchingLine(r),
    );

    const awayLineup: BoxBatterOut[] = [];
    const homeLineup: BoxBatterOut[] = [];
    const awayPitchers: BoxPitcherOut[] = [];
    const homePitchers: BoxPitcherOut[] = [];

    function sideFor(teamRaw: string): "away" | "home" | null {
      const slug = toSlug(cleanName(teamRaw));
      if (slug === game!.away_team_id) return "away";
      if (slug === game!.home_team_id) return "home";
      return null;
    }

    for (const r of battingRaw) {
      const side = sideFor(r.team);
      if (!side) {
        warnings.push(
          `batting_line ${r.id}: team "${r.team}" matches neither away "${game.away_team_id}" nor home "${game.home_team_id}" of game ${gameId}`,
        );
        continue;
      }
      const teamSlug =
        side === "away" ? game.away_team_id : game.home_team_id;
      const resolved = resolvePlayerId(
        nameToId,
        teamSlug,
        r.player_name,
      );
      if (!resolved.resolved) {
        unresolvedNames++;
        bumpOrphan(resolved.id, teamSlug, r.player_name);
      }
      const out: BoxBatterOut = {
        player_id: resolved.id,
        player_name: cleanName(r.player_name),
        slot: r.slot == null || r.slot === "" ? null : String(r.slot),
        pos: r.pos ?? null,
        ab: Number(r.ab ?? 0),
        r: Number(r.r ?? 0),
        h: Number(r.h ?? 0),
        doubles: Number(r.doubles ?? 0),
        triples: Number(r.triples ?? 0),
        hr: Number(r.hr ?? 0),
        rbi: Number(r.rbi ?? 0),
        bb: Number(r.bb ?? 0),
        so: Number(r.k ?? 0),
        sb: Number(r.sb ?? 0),
        hbp: Number(r.hbp ?? 0),
        sf: Number(r.sf ?? 0),
        sac: Number(r.sac ?? 0),
        fc: Number(r.fc ?? 0),
        roe: Number(r.roe ?? 0),
        cs: Number(r.cs ?? 0),
        source_line_id: r.id,
      };
      (side === "away" ? awayLineup : homeLineup).push(out);
    }

    for (const r of pitchingRaw) {
      const side = sideFor(r.team);
      if (!side) {
        warnings.push(
          `pitching_line ${r.id}: team "${r.team}" matches neither away nor home of game ${gameId}`,
        );
        continue;
      }
      const teamSlug =
        side === "away" ? game.away_team_id : game.home_team_id;
      const resolved = resolvePlayerId(
        nameToId,
        teamSlug,
        r.player_name,
      );
      if (!resolved.resolved) {
        unresolvedNames++;
        bumpOrphan(resolved.id, teamSlug, r.player_name);
      }
      const dec =
        r.decision === "W" || r.decision === "L" || r.decision === "S"
          ? r.decision
          : null;
      const out: BoxPitcherOut = {
        player_id: resolved.id,
        player_name: cleanName(r.player_name),
        ip_outs: ipToOuts(r.ip),
        h: Number(r.h ?? 0),
        r: Number(r.r ?? 0),
        er: Number(r.er ?? 0),
        bb: Number(r.bb ?? 0),
        so: Number(r.k ?? 0),
        decision: dec,
        source_line_id: r.id,
      };
      (side === "away" ? awayPitchers : homePitchers).push(out);
    }

    // Sort lineups by slot when present (numeric leading number),
    // else stable insertion order.
    function slotKey(b: BoxBatterOut): number {
      if (!b.slot) return 999;
      const m = /^(\d+)/.exec(String(b.slot));
      return m ? parseInt(m[1]!, 10) : 999;
    }
    awayLineup.sort((a, b) => slotKey(a) - slotKey(b));
    homeLineup.sort((a, b) => slotKey(a) - slotKey(b));

    // Linescore + H/E live in games.innings (jsonb). Shape from
    // PLATFORM_MIGRATION.md §3:
    //   { away: [r1..r9], home: [...], awayH, awayE, homeH, homeE }
    const inn = (game.innings ?? {}) as Record<string, unknown>;
    const awayLine = Array.isArray(inn.away)
      ? (inn.away as unknown[]).map((v) => Number(v) || 0)
      : [];
    const homeLine = Array.isArray(inn.home)
      ? (inn.home as unknown[]).map((v) => Number(v) || 0)
      : [];

    boxes.push({
      game_id: String(gameId),
      away_lineup: awayLineup,
      home_lineup: homeLineup,
      away_pitchers: awayPitchers,
      home_pitchers: homePitchers,
      linescore: { away: awayLine, home: homeLine },
      hits: {
        away: inn.awayH == null ? null : Number(inn.awayH),
        home: inn.homeH == null ? null : Number(inn.homeH),
      },
      errors: {
        away: inn.awayE == null ? null : Number(inn.awayE),
        home: inn.homeE == null ? null : Number(inn.homeE),
      },
    });
  }

  // Fill in score-only stubs for every final game that has no
  // batting/pitching lines. LBDC's "Score Only" capture mode (per
  // PLATFORM_MIGRATION.md §3) and any older games where the
  // captain never entered a lineup end up here. Without a stub,
  // leagueplatform's /games/[id] route shows "no box score yet"
  // even though we know the final score. The stub sets
  // away_score_only/home_score_only = true so the renderer hides
  // the empty lineup table cleanly.
  const haveBox = new Set(boxes.map((b) => b.game_id));
  for (const g of games) {
    if (g.status !== "final") continue;
    if (haveBox.has(g.id)) continue;
    boxes.push({
      game_id: g.id,
      away_lineup: [],
      home_lineup: [],
      away_pitchers: [],
      home_pitchers: [],
      linescore: { away: [], home: [] },
      hits: { away: null, home: null },
      errors: { away: null, home: null },
      // Score-only flags — picked up by the leagueplatform
      // box-score renderer (lib/box-score-data.ts) to suppress
      // the empty lineup table.
      // @ts-expect-error extending BoxScoreOut shape ad-hoc; these
      // pass through verbatim and the seed step doesn't care.
      away_score_only: true,
      home_score_only: true,
    });
  }

  return { boxes, unresolvedNames, orphans };
}

// ── main ────────────────────────────────────────────────────────────

function main() {
  if (!fs.existsSync(RAW_DIR)) {
    console.error(
      `[transform-lbdc] No raw dump found at ${RAW_DIR}. Run \`npm run dump:lbdc\` first.`,
    );
    process.exit(2);
  }
  // Reset output dir so stale files from a previous run don't linger.
  if (fs.existsSync(OUT_DIR)) fs.rmSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const warnings: string[] = [];

  const seasons = readRaw<SeasonRaw>("seasons");
  const games = readRaw<GameRaw>("games");
  const tournGames = readRaw<TournRaw>("tournament_games");
  const rosters = readRaw<RosterRow>("lbdc_rosters");
  const news = readRaw("news");
  const signups = readRaw("lbdc_signups");
  const payments = readRaw("player_payments");
  const availability = readRaw("availability");
  const gallery = readRaw("lbdc_gallery");
  // Singletons — first (only) row.
  const alert = readRaw("lbdc_alert")[0] ?? null;
  const contact = readRaw("lbdc_contact")[0] ?? null;
  const divisions = readRaw("lbdc_divisions")[0] ?? null;
  const fields = readRaw("lbdc_fields")[0] ?? null;
  const rules = readRaw("lbdc_rules")[0] ?? null;
  const sponsors = readRaw("lbdc_sponsors")[0] ?? null;
  const tournamentMeta = readRaw("lbdc_tournament_meta")[0] ?? null;
  const pageContent = readRaw("lbdc_page_content")[0] ?? null;
  const schedules = readRaw("lbdc_schedules");

  // 1. Seasons.
  const { out: seasonOut, pgToSlug: seasonPgToSlug } = buildSeasons(seasons);
  writeDocs(
    "seasons",
    [...seasonOut.values()].map((s) => ({ id: s.id, data: s })),
  );

  // 2. Teams (from rosters ∪ games ∪ tournament_games).
  const teams = buildTeams(rosters, games, tournGames);
  writeDocs(
    "teams",
    [...teams.values()].map((t) => ({ id: t.id, data: t })),
  );

  // 3. Players (from rosters).
  const { players, nameToId } = buildPlayers(rosters, teams);
  writeDocs(
    "players",
    [...players.values()].map((p) => ({ id: p.id, data: p })),
  );

  // 4. Games (regular + playoff, but NOT tournament).
  const gameOut = buildGames(games, seasonPgToSlug, teams, warnings);
  writeDocs(
    "games",
    gameOut.map((g) => ({ id: g.id, data: g })),
  );

  // 5. Tournament games (separate collection).
  const tournOut = buildTournamentGames(tournGames, teams, warnings);
  writeDocs(
    "tournament_games",
    tournOut.map((g) => ({ id: g.id, data: g })),
  );

  // 6. News (pass-through with cleanName on author + cleanHeadline
  // on title).
  writeDocs(
    "news",
    news.map((n: Record<string, unknown>) => ({
      id: String(n.id),
      data: {
        id: String(n.id),
        title: cleanHeadline(n.title),
        body: String(n.body ?? ""),
        event_date: n.event_date ?? null,
        pinned: Boolean(n.pinned),
        created_at: n.created_at ?? null,
        source_id: n.id,
      },
    })),
  );

  // 7. Signups (form submissions, cleaned).
  writeDocs(
    "signups",
    signups.map((s: Record<string, unknown>) => ({
      id: String(s.id),
      data: {
        ...s,
        name: cleanName(s.name),
        team: cleanName(s.team),
        source_id: s.id,
      },
    })),
  );

  // 8. Payments (player_payments, name-cleaned).
  writeDocs(
    "payments",
    payments.map((p: Record<string, unknown>, i: number) => ({
      id: String(p.id ?? `pay_${i}`),
      data: {
        ...p,
        player_name: cleanName(p.player_name),
        team_name: cleanName(p.team_name),
        source_id: p.id,
      },
    })),
  );

  // 9. Availability (per-player per-game RSVPs).
  writeDocs(
    "availability",
    availability.map((a: Record<string, unknown>, i: number) => ({
      id: String(a.id ?? `avail_${i}`),
      data: {
        ...a,
        player_name: cleanName(a.player_name),
        source_id: a.id,
      },
    })),
  );

  // 10. Photos.
  writeDocs(
    "photos",
    gallery.map((g: Record<string, unknown>) => ({
      id: String(g.id),
      data: { ...g, source_id: g.id },
    })),
  );

  // 10b. Box scores (assembled from batting + pitching lines, keyed
  // by game source_id so it matches games/<id>.json).
  const battingRaw = readRaw<BattingLineRaw>("batting_lines");
  const pitchingRaw = readRaw<PitchingLineRaw>("pitching_lines");
  const { boxes, unresolvedNames, orphans } = buildBoxScores(
    battingRaw,
    pitchingRaw,
    gameOut,
    nameToId,
    warnings,
  );
  writeDocs(
    "box_scores",
    boxes.map((b) => ({ id: b.game_id, data: b })),
  );

  // 10c. Auto-create orphan player docs so box-score views still
  // resolve names to a player record. These are batters/pitchers
  // who appeared in stat lines but aren't in lbdc_rosters — mostly
  // players on cross-league opposing teams (Angels, Mets, HBC, etc.)
  // that LBDC plays but doesn't maintain rosters for.
  const orphanPlayerDocs = [...orphans.values()].map((o) => ({
    id: o.id,
    data: {
      id: o.id,
      name: o.player_name,
      team_id: o.team_id,
      number: null,
      status: "unknown" as const,
      under_21: /\*\s*$/.test(o.player_name),
      orphan: true,
      appearances: o.appearances,
    },
  }));
  writeDocs("players", orphanPlayerDocs);

  // 11. Singletons → /_config/<key>.json
  const configDir = path.join(OUT_DIR, "_config");
  fs.mkdirSync(configDir, { recursive: true });
  const singletons: [string, unknown][] = [
    ["alert", alert],
    ["contact", contact],
    ["divisions", divisions],
    ["fields", fields],
    ["rules", rules],
    ["sponsors", sponsors],
    ["tournament_meta", tournamentMeta],
    ["page_content", pageContent],
  ];
  for (const [name, body] of singletons) {
    fs.writeFileSync(
      path.join(configDir, `${name}.json`),
      JSON.stringify(body ?? null, null, 2) + "\n",
    );
  }
  // Raw schedules blob is per-division — keep its shape so the seeder
  // can split it into games later.
  fs.writeFileSync(
    path.join(configDir, "schedules.json"),
    JSON.stringify(schedules, null, 2) + "\n",
  );

  // 12. nameToId map — exported so the box-score transform (Phase 2)
  // can link batting/pitching lines to players without re-deriving.
  fs.writeFileSync(
    path.join(OUT_DIR, "_player_lookup.json"),
    JSON.stringify(
      Object.fromEntries([...nameToId.entries()]),
      null,
      2,
    ) + "\n",
  );

  // 13. Manifest.
  const manifest = {
    generated_at: new Date().toISOString(),
    source_raw_dir: RAW_DIR,
    counts: {
      seasons: seasonOut.size,
      teams: teams.size,
      players_rostered: players.size,
      players_orphan: orphans.size,
      players_total: players.size + orphans.size,
      games: gameOut.length,
      tournament_games: tournOut.length,
      news: news.length,
      signups: signups.length,
      payments: payments.length,
      availability: availability.length,
      photos: gallery.length,
      box_scores: boxes.length,
      batting_lines_input: battingRaw.length,
      pitching_lines_input: pitchingRaw.length,
      unresolved_player_names: unresolvedNames,
      orphan_players_created: orphans.size,
    },
    season_merges: [...seasonOut.values()]
      .filter((s) => s.source_ids.length > 1)
      .map((s) => ({
        merged_into: s.id,
        merged_from_pg_ids: s.source_ids,
        canonical_name: s.name,
      })),
    warnings,
  };
  fs.writeFileSync(
    path.join(OUT_DIR, "_manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );

  console.log(`[transform-lbdc] Wrote to ${OUT_DIR}`);
  console.log(
    `  seasons:          ${manifest.counts.seasons.toString().padStart(5)}`,
  );
  console.log(
    `  teams:            ${manifest.counts.teams.toString().padStart(5)}`,
  );
  console.log(
    `  players:          ${manifest.counts.players_total.toString().padStart(5)}  (rostered: ${manifest.counts.players_rostered}, orphan auto-created: ${manifest.counts.players_orphan})`,
  );
  console.log(
    `  games:            ${manifest.counts.games.toString().padStart(5)}`,
  );
  console.log(
    `  tournament_games: ${manifest.counts.tournament_games.toString().padStart(5)}`,
  );
  console.log(
    `  news:             ${manifest.counts.news.toString().padStart(5)}`,
  );
  console.log(
    `  signups:          ${manifest.counts.signups.toString().padStart(5)}`,
  );
  console.log(
    `  payments:         ${manifest.counts.payments.toString().padStart(5)}`,
  );
  console.log(
    `  availability:     ${manifest.counts.availability.toString().padStart(5)}`,
  );
  console.log(
    `  photos:           ${manifest.counts.photos.toString().padStart(5)}`,
  );
  console.log(
    `  box_scores:       ${manifest.counts.box_scores.toString().padStart(5)}  (from ${manifest.counts.batting_lines_input} batting + ${manifest.counts.pitching_lines_input} pitching lines)`,
  );
  if (manifest.counts.unresolved_player_names > 0) {
    console.log(
      `                    ⚠ ${manifest.counts.unresolved_player_names} player_name(s) couldn't be resolved to a roster — emitted as orphan ids`,
    );
  }
  if (manifest.season_merges.length) {
    console.log(`\n[transform-lbdc] Merged seasons:`);
    for (const m of manifest.season_merges) {
      console.log(
        `  ${m.merged_into.padEnd(28)} ← pg ids ${m.merged_from_pg_ids.join(", ")}  (${m.canonical_name})`,
      );
    }
  }
  if (warnings.length) {
    console.log(`\n[transform-lbdc] ${warnings.length} warning(s):`);
    for (const w of warnings.slice(0, 20)) console.log(`  ⚠ ${w}`);
    if (warnings.length > 20) {
      console.log(`  … ${warnings.length - 20} more in _manifest.json`);
    }
  }
}

main();
