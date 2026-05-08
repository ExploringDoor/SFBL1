// One-off scraper: pull every season of SFBL standings out of
// BallgameCentral so we can build a "League History" page.
//
// Why this exists:
//   SFBL has been on BGC since 2003. Their standings page renders
//   server-side ASP HTML — no API, no exports. The only way to get
//   the history is to drive the form (season × game-type × division)
//   and parse the resulting table.
//
// Mechanic (matches scrape-bgc-rosters.ts):
//   1. GET the page once to acquire a session cookie.
//   2. POST per (season, game_type, division) tuple. The form
//      renders a #EEEECC-coloured header row + alternating
//      #EEEEEE / #FFFFFF body rows when there's data, or nothing
//      when the combination doesn't exist.
//   3. Decode response as Windows-1252 (BGC's quirky encoding) so
//      Spanish names round-trip correctly.
//
// Usage:
//   npx tsx scripts/scrape-bgc-standings.ts
//
// Output:
//   data/sfbl/historical-standings.json — array of:
//     { season, game_type, division, standings: [{ team, w, l, t, g, pct, p }] }
//   only including non-empty results, sorted newest-first.

import * as fs from "node:fs";
import * as path from "node:path";

const URL_STANDINGS =
  "https://www.ballgamecentral.com/sfbl/Standings.asp?LCID=1";

// Game types we care about for the history page. Skip Exhibition,
// Tournament, Excluded, Other — those rarely have standings worth
// archiving and pollute the picker.
const GAME_TYPES: Array<{ id: string; label: "season" | "playoff" }> = [
  { id: "1", label: "season" },
  { id: "2", label: "playoff" },
];

// Divisions BGC exposes for SFBL. The empty `""` value is
// "[No Division]" — leagues used it pre-2010 before divisions were a
// thing, so we still need to query it for old seasons.
const DIVISIONS: string[] = [
  "",
  "18+ Division",
  "28+ Division",
  "35+ Division",
  "Premier Division",
];

interface StandingRow {
  team: string;
  w: number;
  l: number;
  t: number;
  g: number;
  pct: string; // ".917"
  p: number; // points
}

interface StandingsBlock {
  season: string; // "Spring - 2024"
  game_type: "season" | "playoff";
  division: string; // "18+ Division" or ""
  standings: StandingRow[];
}

/** Pull the season options from the initial GET so we get the live
 *  list (2003 → 2026 plus odd-format seasons like Florida Cup 2007).
 *  Filed against the dropdown rather than hard-coded so this still
 *  works next year without code changes. */
function parseSeasons(html: string): string[] {
  const sel = /<select[^>]*name=['"]?ddlSeason['"]?[^>]*>([\s\S]*?)<\/select>/i.exec(
    html,
  );
  if (!sel) return [];
  const opts = [
    ...sel[1]!.matchAll(
      /<option[^>]*value=['"]([^'"]*)['"]?[^>]*>([^<]*)<\/option>/gi,
    ),
  ];
  return opts
    .map((o) => o[1]!.trim())
    .filter((v) => v.length > 0);
}

/** Strip HTML tags + decode the handful of entities BGC actually
 *  emits. We don't bother with a full HTML parser — the table cells
 *  are plain text after the regex grab. */
function decodeCell(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

/** Parse a standings table out of a BGC response. The table starts
 *  with a TR whose bgcolor is `#EEEECC` (the header) and continues
 *  with alternating `#EEEEEE` / `#FFFFFF` body rows until it hits
 *  something that isn't a TD-of-DataText. Returns [] when there's no
 *  table (BGC just renders the form again with the prompt). */
function parseStandings(html: string): StandingRow[] {
  // Locate the header to confirm the table exists.
  const headerIdx = html.indexOf("#EEEECC");
  if (headerIdx === -1) return [];

  // From the header, grab every body row up to the closing </TABLE>
  // (or end-of-table marker — the ASP page nests one TABLE inside
  // another, so a defensive cap of ~50 rows is plenty).
  const after = html.slice(headerIdx);
  const tableEnd = after.search(/<\/TABLE>/i);
  const region = tableEnd === -1 ? after : after.slice(0, tableEnd);

  const rows: StandingRow[] = [];
  const rowRe =
    /<TR\s+bgcolor=['"]?(?:#EEEEEE|#FFFFFF)['"]?[^>]*>([\s\S]*?)<\/TR>/gi;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(region)) !== null) {
    const tdRe = /<TD[^>]*>([\s\S]*?)<\/TD>/gi;
    const cells: string[] = [];
    let tm: RegExpExecArray | null;
    while ((tm = tdRe.exec(m[1]!)) !== null) {
      cells.push(decodeCell(tm[1]!));
    }
    // Expect 7 columns: team, W, L, T, G, Pct, P
    if (cells.length < 7) continue;
    const [team, w, l, t, g, pct, p] = cells;
    if (!team) continue;
    rows.push({
      team: team!,
      w: parseInt(w!, 10) || 0,
      l: parseInt(l!, 10) || 0,
      t: parseInt(t!, 10) || 0,
      g: parseInt(g!, 10) || 0,
      pct: pct!,
      p: parseInt(p!, 10) || 0,
    });
  }
  return rows;
}

/** Sort key for season strings. We want newest first; "Spring 2024"
 *  > "Fall 2023" > "Florida Cup 2007" > "Summer 2007" > "Spring 2007".
 *  Encode as (year * 10) + season-tier, where tier orders Florida
 *  Cup < Summer < Spring < Fall to roughly track real-world
 *  chronology. The exact ordering inside a year barely matters — the
 *  picker shows full season strings — but keeping it consistent
 *  makes the JSON diffable. */
function seasonSortKey(s: string): number {
  const m = /^(\w+(?:\s\w+)?)\s*-\s*(\d{4})$/.exec(s);
  if (!m) return 0;
  const [, label, year] = m;
  const tier =
    label === "Florida Cup" ? 1
    : label === "Spring" ? 2
    : label === "Summer" ? 3
    : label === "Fall" ? 4
    : 0;
  return parseInt(year!, 10) * 10 + tier;
}

async function main() {
  // 1) Acquire session cookie + season list from initial GET.
  const initRes = await fetch(URL_STANDINGS, {
    headers: { "User-Agent": "Mozilla/5.0 (LeagueEngine import)" },
  });
  const setCookie = initRes.headers.get("set-cookie") ?? "";
  const sessionCookie = setCookie.split(";")[0];
  if (!sessionCookie) {
    console.error("[scrape] No session cookie returned. Aborting.");
    process.exit(1);
  }
  const initBuf = await initRes.arrayBuffer();
  const initHtml = new TextDecoder("windows-1252").decode(initBuf);
  const seasons = parseSeasons(initHtml);
  if (seasons.length === 0) {
    console.error("[scrape] No seasons parsed from page. Aborting.");
    process.exit(1);
  }
  console.log(
    `[scrape] Got session cookie. Walking ${seasons.length} seasons × ${GAME_TYPES.length} types × ${DIVISIONS.length} divisions = ${seasons.length * GAME_TYPES.length * DIVISIONS.length} requests`,
  );

  // 2) Cross-product walk.
  const blocks: StandingsBlock[] = [];
  for (const season of seasons) {
    for (const gt of GAME_TYPES) {
      for (const div of DIVISIONS) {
        const body = new URLSearchParams({
          ddlSeason: season,
          GameTypeID: gt.id,
          ddlDivision: div,
        });
        const res = await fetch(URL_STANDINGS, {
          method: "POST",
          headers: {
            "User-Agent": "Mozilla/5.0 (LeagueEngine import)",
            "Content-Type": "application/x-www-form-urlencoded",
            Cookie: sessionCookie,
            Referer: URL_STANDINGS,
          },
          body: body.toString(),
        });
        const buf = await res.arrayBuffer();
        const html = new TextDecoder("windows-1252").decode(buf);
        const rows = parseStandings(html);
        if (rows.length > 0) {
          blocks.push({
            season,
            game_type: gt.label,
            division: div,
            standings: rows,
          });
          const divLabel = div || "(no division)";
          console.log(
            `  ${season.padEnd(20)} ${gt.label.padEnd(8)} ${divLabel.padEnd(18)} ${rows.length} teams`,
          );
        }
        // Be polite to BGC.
        await new Promise((r) => setTimeout(r, 200));
      }
    }
  }

  // 3) Sort newest-first, then by game_type (season before playoff),
  //    then by division for stable diffs.
  blocks.sort((a, b) => {
    const sk = seasonSortKey(b.season) - seasonSortKey(a.season);
    if (sk !== 0) return sk;
    if (a.game_type !== b.game_type) {
      return a.game_type === "season" ? -1 : 1;
    }
    return a.division.localeCompare(b.division);
  });

  // 4) Write JSON.
  const outDir = path.resolve(process.cwd(), "data/sfbl");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "historical-standings.json");
  fs.writeFileSync(outPath, JSON.stringify(blocks, null, 2) + "\n");
  console.log(
    `\n[scrape] Wrote ${blocks.length} standings blocks to ${outPath}`,
  );
}

main().catch((e) => {
  console.error(`[scrape] failed: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
