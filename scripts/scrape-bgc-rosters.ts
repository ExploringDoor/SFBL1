// One-off scraper: pull the SFBL team rosters out of BallgameCentral
// (the third-party scoring system the league has used for years) and
// emit `data/sfbl/players.csv` ready for the provision script.
//
// Why this exists:
//   The SFBL website embeds an iframe to BallgameCentral for rosters
//   (sfbl.com/team-rosters/ → www.ballgamecentral.com/sfbl/Rosters.asp).
//   No API. No exports. The rosters are server-rendered ASP HTML
//   keyed by an internal team id (TID). Login required for the form
//   to "stick" — the first GET sets a session cookie that subsequent
//   POSTs use to scope responses to the selected team.
//
// Usage:
//   npx tsx scripts/scrape-bgc-rosters.ts
//
// Output:
//   data/sfbl/players.csv with columns:
//     team_id, name, jersey, position, email, phone
//   (email + phone left blank — BGC doesn't expose those on rosters.
//    Captains can fill them in via the captain portal post-launch.)

import * as fs from "node:fs";
import * as path from "node:path";

// ── BGC team-id → our slug mapping ──────────────────────────────────
// TIDs come from the BGC Rosters.asp dropdown. Slugs match the kebab-
// case ids used in scripts/templates/teams.csv and the logos in
// public/logos/sfbl/. "Miami Marlins" (TID 1465) was on BGC but not
// on the old SFBL Next.js site and has no logo on file — skipped here
// so the audit doesn't flag a missing logo. Add manually if needed.
const TEAMS: Array<{ tid: number; slug: string; bgcName: string }> = [
  { tid: 1436, slug: "aventura-braves", bgcName: "Aventura Braves" },
  { tid: 1437, slug: "aventura-dodgers", bgcName: "Aventura Dodgers" },
  { tid: 1447, slug: "boca-mets", bgcName: "Boca Mets" },
  { tid: 1458, slug: "broward-senators", bgcName: "Broward Senators" },
  { tid: 1443, slug: "broward-yankees", bgcName: "Broward Yankees" },
  { tid: 1454, slug: "dade-nationals", bgcName: "Dade Nationals" },
  { tid: 1449, slug: "delray-devil-rays", bgcName: "Delray Devil Rays" },
  { tid: 1448, slug: "kooper-city-royals", bgcName: "Kooper City Royals" },
  { tid: 1442, slug: "margate-marlins", bgcName: "Margate Marlins" },
  { tid: 1463, slug: "matanzas", bgcName: "Matanzas" },
  { tid: 1456, slug: "miami-amigos", bgcName: "Miami Amigos" },
  { tid: 1459, slug: "miami-brewers", bgcName: "Miami Brewers" },
  { tid: 1464, slug: "miami-buccaneers", bgcName: "Miami Buccaneers" },
  { tid: 1451, slug: "miami-cardinals", bgcName: "Miami Cardinals" },
  { tid: 1453, slug: "miami-charros", bgcName: "Miami Charros" },
  { tid: 1438, slug: "miami-jc", bgcName: "Miami JC" },
  { tid: 1444, slug: "miami-orioles", bgcName: "Miami Orioles" },
  { tid: 1445, slug: "miami-red-sox", bgcName: "Miami Red Sox" },
  { tid: 1450, slug: "miami-yankees", bgcName: "Miami Yankees" },
  { tid: 1457, slug: "palm-beach-pirates", bgcName: "Palm Beach Pirates" },
  { tid: 1446, slug: "sf-angels", bgcName: "South Florida Angels" },
  { tid: 1461, slug: "sf-astros", bgcName: "South Florida Astros" },
  { tid: 1452, slug: "sf-dodgers", bgcName: "South Florida Dodgers" },
  { tid: 1441, slug: "sf-rays", bgcName: "South Florida Rays" },
  { tid: 1460, slug: "sf-travelers", bgcName: "South Florida Travelers" },
  { tid: 1455, slug: "southern-yankees", bgcName: "Southern Yankees" },
  { tid: 1440, slug: "sunrise-giants", bgcName: "Sunrise Giants" },
  { tid: 1462, slug: "wpb-cardinals", bgcName: "West Palm Beach Cardinals" },
];

const SEASON = "Spring - 2026";
const ROSTERS_URL = "https://www.ballgamecentral.com/sfbl/Rosters.asp?LCID=1";

// ── helpers ────────────────────────────────────────────────────────

interface Player {
  team_id: string;
  name: string;
  jersey: string;
  position: string;
}

/** Parse a BGC roster page's HTML into player rows. The rosters
 *  table lays each player as 3 consecutive <td class='DataText'
 *  width=160> cells: name, date-added, positions. We collect every
 *  matching cell into a flat list, slice into groups of 3, and parse
 *  name + jersey from the first cell. */
function parseRoster(html: string, slug: string): Player[] {
  const players: Player[] = [];
  // Match TD cells that have class='DataText' AND width=160 (the
  // exact triple BGC uses for roster rows; other DataText cells in
  // the page header don't carry width).
  const cellRe = /<TD[^>]*class=['"]?DataText['"]?[^>]*width=160[^>]*>([\s\S]*?)<\/TD>/gi;
  const cells: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = cellRe.exec(html)) !== null) {
    cells.push(decodeHtml(m[1]!).trim());
  }
  // Group into name/date/position triples.
  for (let i = 0; i + 2 < cells.length; i += 3) {
    const rawName = cells[i]!;
    const positions = cells[i + 2]!;
    if (!rawName) continue;
    // Skip the 3-row header. BGC emits header cells with empty/nbsp
    // content via the same triple structure, so any row whose name
    // doesn't have a comma is almost certainly a header artifact.
    if (!rawName.includes(",")) continue;
    // Name format: "Last, First" or "Last, First (Jersey)". Treat
    // parens content as a jersey ONLY when it's a number — managers
    // sometimes use the parens for free-text annotations like
    // "(maybe)" or "(coach)" which should be dropped, not imported
    // as a jersey number that crashes the provision validator.
    const jerseyMatch = rawName.match(/\(([^)]+)\)\s*$/);
    const jerseyRaw = jerseyMatch ? jerseyMatch[1]!.trim() : "";
    const jersey = /^\d+$/.test(jerseyRaw) ? jerseyRaw : "";
    const nameOnly = rawName.replace(/\s*\([^)]+\)\s*$/, "").trim();
    // Convert "Last, First" → "First Last" for the LeagueEngine
    // convention (most leagues display first-name-first).
    const parts = nameOnly.split(",").map((s) => s.trim());
    const display = parts.length === 2 ? `${parts[1]} ${parts[0]}` : nameOnly;
    players.push({
      team_id: slug,
      name: display,
      jersey,
      position: positions,
    });
  }
  return players;
}

function decodeHtml(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function csvEscape(v: string): string {
  if (v.includes(",") || v.includes('"') || v.includes("\n")) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

// ── main ───────────────────────────────────────────────────────────

async function main() {
  // 1) Acquire a session cookie by GETting the rosters page once.
  const initRes = await fetch(ROSTERS_URL, {
    headers: { "User-Agent": "Mozilla/5.0 (LeagueEngine import)" },
  });
  const setCookie = initRes.headers.get("set-cookie") ?? "";
  const sessionCookie = setCookie.split(";")[0]; // first cookie
  if (!sessionCookie) {
    console.error("No session cookie returned from BGC. Aborting.");
    process.exit(1);
  }
  console.log(`[scrape] Got session cookie. Walking ${TEAMS.length} teams…`);

  // 2) POST per team, parse, accumulate.
  const allPlayers: Player[] = [];
  for (const team of TEAMS) {
    const body = new URLSearchParams({
      ddlSeason: SEASON,
      ddlTeams: String(team.tid),
    });
    const res = await fetch(ROSTERS_URL, {
      method: "POST",
      headers: {
        "User-Agent": "Mozilla/5.0 (LeagueEngine import)",
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: sessionCookie,
        Referer: ROSTERS_URL,
      },
      body: body.toString(),
    });
    // BGC's ASP forms return Windows-1252 (cp1252) — using the
    // default UTF-8 decode mangles Spanish names like "Muñoz" or
    // "González" into U+FFFD. Read the buffer manually and decode
    // with TextDecoder("windows-1252") which falls back to Latin-1
    // semantics for the bytes we care about.
    const buf = await res.arrayBuffer();
    const html = new TextDecoder("windows-1252").decode(buf);
    const players = parseRoster(html, team.slug);
    console.log(`  ${team.slug.padEnd(24)} ${players.length} players`);
    allPlayers.push(...players);
    // Be polite — don't hammer their server.
    await new Promise((r) => setTimeout(r, 250));
  }

  // 3) Write data/sfbl/players.csv.
  const outDir = path.resolve(process.cwd(), "data/sfbl");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "players.csv");
  const header = "team_id,name,jersey,position,email,phone";
  const lines = [header];
  for (const p of allPlayers) {
    lines.push(
      [
        csvEscape(p.team_id),
        csvEscape(p.name),
        csvEscape(p.jersey),
        csvEscape(p.position),
        "", // email
        "", // phone
      ].join(","),
    );
  }
  fs.writeFileSync(outPath, lines.join("\n") + "\n");
  console.log(
    `\n[scrape] Wrote ${allPlayers.length} players to ${outPath}`,
  );
}

main().catch((e) => {
  console.error(`[scrape] failed: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
