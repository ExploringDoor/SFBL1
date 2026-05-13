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

function buildGames(
  games: GameRaw[],
  pgSeasonToSlug: Map<number, string>,
  teams: Map<string, TeamOut>,
  warnings: string[],
): GameOut[] {
  const out: GameOut[] = [];
  for (const g of games) {
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
      players: players.size,
      games: gameOut.length,
      tournament_games: tournOut.length,
      news: news.length,
      signups: signups.length,
      payments: payments.length,
      availability: availability.length,
      photos: gallery.length,
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
    `  players:          ${manifest.counts.players.toString().padStart(5)}`,
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
