// Scrape BallgameCentral's Scores.asp to get the current canonical
// game results for the season, then patch data/sfbl/schedule.csv
// with anything new (4/26+ games that were "scheduled" in the
// snapshot but have since been played and have official scores).
//
// Usage:
//   npx tsx scripts/scrape-bgc-scores.ts
//
// Idempotent — running it again is a no-op if BGC hasn't changed.
// Doesn't touch games already marked "final" with matching scores.
//
// Pre-existing slug mapping (BGC team name → our kebab-case slug)
// is the same as in scripts/scrape-bgc-rosters.ts.

import * as fs from "node:fs";
import * as path from "node:path";

const BGC_NAME_TO_SLUG: Record<string, string> = {
  "Aventura Braves": "aventura-braves",
  "Aventura Dodgers": "aventura-dodgers",
  "Boca Mets": "boca-mets",
  "Broward Senators": "broward-senators",
  "Broward Yankees": "broward-yankees",
  "Dade Nationals": "dade-nationals",
  "Delray Devil Rays": "delray-devil-rays",
  "Kooper City Royals": "kooper-city-royals",
  "Margate Marlins": "margate-marlins",
  "Matanzas": "matanzas",
  "Miami Amigos": "miami-amigos",
  "Miami Brewers": "miami-brewers",
  "Miami Buccaneers": "miami-buccaneers",
  "Miami Cardinals": "miami-cardinals",
  "Miami Charros": "miami-charros",
  "Miami JC": "miami-jc",
  "Miami Marlins": "miami-marlins", // not in our roster but acknowledge
  "Miami Orioles": "miami-orioles",
  "Miami Red Sox": "miami-red-sox",
  "Miami Yankees": "miami-yankees",
  "Palm Beach Pirates": "palm-beach-pirates",
  "South Florida Angels": "sf-angels",
  "South Florida Astros": "sf-astros",
  "South Florida Dodgers": "sf-dodgers",
  "South Florida Rays": "sf-rays",
  "South Florida Travelers": "sf-travelers",
  "Southern Yankees": "southern-yankees",
  "Sunrise Giants": "sunrise-giants",
  "West Palm Beach Cardinals": "wpb-cardinals",
};

const SCORES_URL = "https://www.ballgamecentral.com/sfbl/Scores.asp?LCID=1";
const SEASON = "Spring - 2026";

interface BgcGame {
  date: string; // yyyy-mm-dd
  away_slug: string;
  home_slug: string;
  away_score: number;
  home_score: number;
}

async function fetchScores(): Promise<string> {
  // GET first to grab a session cookie.
  const initRes = await fetch(SCORES_URL, {
    headers: { "User-Agent": "Mozilla/5.0 (LeagueEngine import)" },
  });
  const setCookie = initRes.headers.get("set-cookie") ?? "";
  const sessionCookie = setCookie.split(";")[0];
  if (!sessionCookie) throw new Error("No session cookie");
  // POST with the season to get scores back.
  const body = new URLSearchParams({ ddlSeason: SEASON });
  const res = await fetch(SCORES_URL, {
    method: "POST",
    headers: {
      "User-Agent": "Mozilla/5.0 (LeagueEngine import)",
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: sessionCookie,
      Referer: SCORES_URL,
    },
    body: body.toString(),
  });
  return res.text();
}

function parseGames(html: string): BgcGame[] {
  // Strip HTML tags + collapse to a flat |-delimited string.
  const flat = html
    .replace(/<[^>]+>/g, "|")
    .replace(/&nbsp;/g, " ")
    .replace(/\|+/g, "|")
    .replace(/[ \t]+/g, " ");

  // Walk linearly, tracking the current date as we hit date markers.
  // Game pattern: "<TeamA> (<div>+ Division)|<TeamB> (<div>+ Division)|<scoreA>|<scoreB>|"
  const dateRe = /(\d{1,2})\/(\d{1,2})\/(\d{4})/g;
  const gameRe =
    /([A-Z][A-Za-z.' ]+?) \((\d+)\+ Division\)\|([A-Z][A-Za-z.' ]+?) \((\d+)\+ Division\)\|\s*(\d+)\s*\|\s*(\d+)\s*\|/g;

  type Event =
    | { kind: "D"; pos: number; date: string }
    | { kind: "G"; pos: number; payload: RegExpExecArray };
  const events: Event[] = [];
  let dm: RegExpExecArray | null;
  while ((dm = dateRe.exec(flat)) !== null) {
    const [, m, d, y] = dm;
    const iso = `${y}-${m!.padStart(2, "0")}-${d!.padStart(2, "0")}`;
    events.push({ kind: "D", pos: dm.index, date: iso });
  }
  let gm: RegExpExecArray | null;
  while ((gm = gameRe.exec(flat)) !== null) {
    events.push({ kind: "G", pos: gm.index, payload: gm });
  }
  events.sort((a, b) => a.pos - b.pos);

  const games: BgcGame[] = [];
  let currentDate: string | null = null;
  for (const ev of events) {
    if (ev.kind === "D") {
      currentDate = ev.date;
      continue;
    }
    const [, away, , home, , aScore, hScore] = ev.payload;
    if (!currentDate) continue;
    const aSlug = BGC_NAME_TO_SLUG[away!.trim()];
    const hSlug = BGC_NAME_TO_SLUG[home!.trim()];
    if (!aSlug || !hSlug) continue; // unknown team
    games.push({
      date: currentDate,
      away_slug: aSlug,
      home_slug: hSlug,
      away_score: parseInt(aScore!, 10),
      home_score: parseInt(hScore!, 10),
    });
  }
  return games;
}

function patchScheduleCsv(games: BgcGame[]): {
  added: number;
  updated: number;
  unchanged: number;
} {
  const csvPath = path.resolve(process.cwd(), "data/sfbl/schedule.csv");
  const lines = fs.readFileSync(csvPath, "utf8").trim().split("\n");
  const header = lines[0]!.split(",");
  const rows = lines.slice(1).map((l) => l.split(","));

  const idx = {
    id: header.indexOf("id"),
    date: header.indexOf("date"),
    away: header.indexOf("away_team_id"),
    home: header.indexOf("home_team_id"),
    status: header.indexOf("status"),
    aScore: header.indexOf("away_score"),
    hScore: header.indexOf("home_score"),
  };

  let added = 0,
    updated = 0,
    unchanged = 0;
  for (const g of games) {
    // Find a row with the same (date, away, home) combo.
    const row = rows.find(
      (r) =>
        r[idx.date]!.startsWith(g.date) &&
        r[idx.away] === g.away_slug &&
        r[idx.home] === g.home_slug,
    );
    if (!row) {
      added++;
      console.error(
        `  SKIP (not in schedule.csv): ${g.date} ${g.away_slug} ${g.away_score} @ ${g.home_slug} ${g.home_score}`,
      );
      continue;
    }
    const wasFinal = row[idx.status] === "final";
    const sameScore =
      Number(row[idx.aScore]) === g.away_score &&
      Number(row[idx.hScore]) === g.home_score;
    if (wasFinal && sameScore) {
      unchanged++;
      continue;
    }
    row[idx.status] = "final";
    row[idx.aScore] = String(g.away_score);
    row[idx.hScore] = String(g.home_score);
    updated++;
  }

  // Write back.
  const out = [
    header.join(","),
    ...rows.map((r) => r.join(",")),
  ].join("\n");
  fs.writeFileSync(csvPath, out + "\n");
  return { added, updated, unchanged };
}

async function main() {
  const html = await fetchScores();
  const games = parseGames(html);
  console.log(`[bgc-scores] Parsed ${games.length} games from BGC`);
  const result = patchScheduleCsv(games);
  console.log(
    `[bgc-scores] Schedule update: ${result.updated} updated, ` +
      `${result.unchanged} unchanged, ${result.added} games not in our schedule (skipped)`,
  );
}

main().catch((e) => {
  console.error(`[bgc-scores] failed: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
