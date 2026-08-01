// One-off importer: pull the Helena Softball Association season off
// LeagueLineup and emit the tenant's provisioning inputs.
//
// Why this exists:
//   HSA has been on LeagueLineup (leaguelineup.com/welcome.asp?url=helenasoftball)
//   for years. No API, no export — the season lives in server-rendered ASP
//   pages keyed by a numeric division id. This script drives those pages and
//   writes the cookie-cutter provisioning inputs, so the tenant is created by
//   `npm run provision` like every other league rather than by hand.
//
// Mechanic:
//   1. GET standings.asp once to read the DivisionID <select> — that gives us
//      every division id + code the league actually uses.
//   2. Per division: teams.asp (TeamID <select> = the division's roster of
//      teams), standings.asp (record table), schedules.asp with teamid=99999
//      ("All teams") which carries date, time, status, score, both teams and
//      the field for every game.
//   3. De-duplicate games across divisions — a game shows up in each division
//      view whose field it shares — and fold in the sponsor names from the
//      league's own "Key to Abbreviations" PDF (see SPONSORS below).
//
// Usage:
//   npx tsx scripts/scrape-helena.ts
//   npx tsx scripts/scrape-helena.ts --verify   (compare derived standings
//                                                against LeagueLineup's own)
//
// Output (all under data/helena/):
//   teams.csv       id,name,abbrev,division,color,logo_url
//   schedule.csv    id,date,time,field,away_team_id,home_team_id,week,division,status,away_score,home_score
//   provision.json  the LeagueConfig + csv pointers
//
// Then:
//   npm run provision:emulator -- --config data/helena/provision.json
//
// No players.csv is emitted. LeagueLineup keeps HSA's rosters behind its own
// login, and the league rosters minors (15+ with parental consent), so roster
// PII stays out of the platform until the league hands it over deliberately.

import * as fs from "node:fs";
import * as path from "node:path";

const BASE = "https://www.leaguelineup.com";
const URL_KEY = "helenasoftball";
const OUT_DIR = path.resolve(process.cwd(), "data/helena");

/* ------------------------------------------------------------------ *
 * Division metadata. LeagueLineup only stores the two-letter code, so
 * the display names come from the league's printed schedule.
 * ------------------------------------------------------------------ */
const DIVISION_NAMES: Record<string, string> = {
  MI: "Men's Division I",
  ME: "Men's Division E",
  MR: "Men's Recreational",
  W: "Women's Division",
  CR: "Coed Red",
  CW: "Coed White",
  CB: "Coed Blue",
};
const DIVISION_ORDER = ["MI", "ME", "MR", "W", "CR", "CW", "CB"];

/* ------------------------------------------------------------------ *
 * Sponsor names, transcribed from the league's 2026 "Key to
 * Abbreviations" PDF (s3.amazonaws.com/my.llfiles.com/00062018/KEY2AB26.pdf).
 * The schedule pages only ever carry the abbreviation, so without this the
 * site would read "SGL/ASW" instead of the sponsor who paid for the team.
 *
 * REFRESH THIS EVERY SEASON — HSA republishes the PDF with the new field.
 * Keys are matched case-insensitively.
 * ------------------------------------------------------------------ */
const SPONSORS: Record<string, string> = {
  // Men's Division I
  Hitmen: "Hitmen / Sleeping Giant Lanes",
  PappasMn: "Pappas Insulation",
  SmokBnt: "Smoking Bunts / MT Kush",
  TopGun: "Top Gun Auto / Buffalo WW",
  // Men's Division E
  ABBooks: "Aunt Bonnie's Books / Quenzer Construction",
  BashBros: "Bash Bros / Buffalo WW",
  Cloud9: "Apogee Gardens",
  CLBrew: "Coors Light / City Brew",
  KAOS: "Blastpros Mobile Sadbusting",
  Regulatr: "Regulators / Chris Halverson",
  Uppies: "Big Belt Automotive",
  Yankdeez: "Yankdeez",
  // Men's Recreational
  BrdgBomb: "Bridge Bombers / Exit Realty Helena",
  BuntForce: "Bunt Force Trauma / Rocky Mountain Refrigeration / Gaining Ground",
  Coke: "Lehrkinds Coca-Cola / Coors",
  EchoCh: "Echo Church",
  EchoChM: "Echo Church",
  HLClub: "Helena Lions Club",
  Trolls: "Trolls",
  // Women's
  BatInten: "Bat Intentions / LeeAnn Hurt",
  DWBalls: "Dolls w/ Balls / Buffalo WW",
  MamaMos: "Mamma Mo's / Silos Junction / VFW / MT Propane",
  "1HitW": "One-Hit Wonders / Andrea Lay's Cleaning Service",
  // Coed Red
  JackWag: "Jack Wagons / Andrea Lay's Cleaning Service",
  MImpact: "Major Impact / Monteriors / Flying Giant Adventure / Sleeping Giant Lanes",
  TheDRoll: "The Diamond Rollers / Inclyne LCC",
  // Coed White
  "1889Amer": "1889 Coffeehouse",
  Alcoball: "Alcoballics / Helena Hydroseed & Landscaping",
  BaseInvd: "Base Invaders / Balanced Chiropractic & Rehab",
  CepScor: "Cephalo Scorins / Global Net",
  EchoChrch: "Echo Church",
  Elite: "Elite Overhead Door",
  GotWings: "Got Wings / Buffalo WW",
  HBBM: "H.B.B.M.",
  HCCGT: "Helena Cycle Center / Greasy Triples",
  HitBrains: "Hit for Brains",
  LordofDing: "Lord of the Dings",
  MMaierle: "Morrison-Maierle",
  MothLod: "Motherlode / Crosscut Building",
  PappasIns: "Pappas Insulation Co.",
  ScaredHit: "Scared Hitless - DCI",
  "SGL/ASW": "SG Lanes / Anderson Stevenson Wilke Funeral Home",
  TingTings: "Tings Tavern / 1st Interstate Bank",
  WindB: "Windsor Bar",
  // Coed Blue
  BOHelena: "Batts Outta Helena",
  BiPBears: "Bi Polar Bears",
  BrewJays: "Brew Jays",
  FreeFight: "Freedom Fighters",
  "HapsS&C": "Haps Bar Sluggers & Chuggers",
  HYP: "Helena Young Professionals / Western Bar",
  HitsGiggle: "Hitts & Giggles / BWW / Sam Allen",
  HotShots: "Pureview Health",
  HopperJk: "Hopper Jackalopes / The Hopper",
  JLRestate: "Jeannie Lake Real Estate",
  Jesters: "Jesters Bar",
  "MHCC#1": "MHCC",
  Misfits: "Missfits / Jackson Murdo & Grant P.C. / Valley Bank",
  OneHitW: "One Hit Wonders",
  PitSlap: "Pitch Slapped / Edge M&D / Always on I.T. / Rocky Mtn Liquor / Behind The Scenes",
  Skoden: "Helena Indian Alliance",
  Sparkys: "Nickels / Mnt Electric / VFW",
  TBallers: "T-Ballers / BWW",
  TeamAPC: "Team Adaptive Performance Center",
  UnstpBall:
    "Unstoppa-balls / BC Concrete Const. / MT Services / TJ Const. / Werner Plumbing & Heating",
};

/* ------------------------------------------------------------------ *
 * fetch + html helpers
 * ------------------------------------------------------------------ */

async function get(page: string, params: Record<string, string | number> = {}): Promise<string> {
  const qs = Object.entries(params)
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const url = `${BASE}/${page}.asp?url=${URL_KEY}${qs ? "&" + qs : ""}`;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return await res.text();
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  throw new Error(`GET ${url} failed: ${String(lastErr)}`);
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));
}

/** Every <tr> on the page as an array of cell strings. */
function tableRows(html: string): string[][] {
  const out: string[][] = [];
  for (const tr of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells: string[] = [];
    for (const td of tr[1]!.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)) {
      cells.push(decodeEntities(td[1]!.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim());
    }
    if (cells.length) out.push(cells);
  }
  return out;
}

/** Options of the named <select>, as [value, label] pairs. */
function selectOptions(html: string, name: string): Array<[string, string]> {
  const block = new RegExp(`name=${name}[\\s\\S]*?</select>`, "i").exec(html);
  if (!block) return [];
  const out: Array<[string, string]> = [];
  for (const m of block[0].matchAll(/<option\s+value="?([^">]+)"?[^>]*>([^<]*)/gi)) {
    out.push([m[1]!.trim(), decodeEntities(m[2]!).trim()]);
  }
  return out;
}

/* HSA's key PDF publishes "team name / sponsor / sponsor / …" on one line,
 * e.g. "Unstoppa-balls / BC Concrete Const. / MT Services / TJ Const. /
 * Werner Plumbing & Heating". The leading segment is what people call the
 * team; the tail is who paid for the jerseys.
 *
 * Only the team name goes in teams.csv. Pushing the full string through as
 * the display name blows out every standings and schedule table — the W-L-T
 * columns get shoved off the right edge (verified on /standings before this
 * split). PLATFORM GAP: there is no per-team sponsor field, so the sponsor
 * tail is dropped rather than displayed. If HSA signs, the fix is a
 * `sponsors` string on the team doc surfaced on the team page. */
function teamDisplayName(full: string): string {
  return splitSponsorString(full)[0]!;
}

/** Split "team / sponsor / sponsor" on the separator slashes only.
 *  "Dolls w/ Balls / Buffalo WW" has a slash that is part of the TEAM name —
 *  the "w/" abbreviation for "with" — and splitting on it produced a team
 *  called "Dolls w" sponsored by "Balls". Protect that idiom first. */
function splitSponsorString(full: string): string[] {
  const GUARD = "\u0000";
  return full
    .replace(/\bw\/\s*/gi, (m) => m.replace("/", GUARD))
    .split("/")
    .map((x) => x.replace(new RegExp(GUARD, "g"), "/ ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/** The businesses backing a team: everything after the team name. HSA runs on
 *  sponsor money — roughly sixty Helena businesses buy these jerseys — and the
 *  league's current site names them nowhere except inside a PDF. */
function teamSponsors(full: string): string {
  return splitSponsorString(full).slice(1).join(" / ");
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** m/d/yyyy -> yyyy-mm-dd */
function toIsoDate(us: string): string {
  const [m, d, y] = us.split("/").map(Number);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** "6:00 pm" -> "18:00" */
function to24h(t: string): string {
  const m = /^(\d{1,2}):(\d{2})\s*(am|pm)$/i.exec(t.trim());
  if (!m) return "";
  let h = Number(m[1]);
  const pm = m[3]!.toLowerCase() === "pm";
  if (pm && h !== 12) h += 12;
  if (!pm && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

/* Team colors. LeagueLineup stores none and HSA teams have no published
 * uniform colors, so deal from a fixed palette of deep, badge-legible tones.
 * Assignment is by position within the division, so it is stable across
 * re-runs and adjacent teams in a standings table never collide. Swap any
 * team's color by hand in teams.csv — provision reads the file, not this. */
const PALETTE = [
  "#124734", "#b4622d", "#1d3f6e", "#7a2233", "#4a5d23", "#6b3fa0",
  "#8a6d1f", "#155e63", "#93331f", "#2f5d3a", "#334155", "#9a3412",
  "#1e5f8c", "#5b2d5b", "#3f6212", "#7c2d12", "#0f766e", "#713f12",
  "#5c4033", "#374151",
];
function teamColor(indexInDivision: number): string {
  return PALETTE[indexInDivision % PALETTE.length]!;
}

function csvCell(v: string | number | null | undefined): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function csv(header: string[], rows: Array<Array<string | number | null>>): string {
  return [header.join(","), ...rows.map((r) => r.map(csvCell).join(","))].join("\n") + "\n";
}

/* ------------------------------------------------------------------ *
 * scrape
 * ------------------------------------------------------------------ */

interface Team {
  id: string; abbr: string; name: string; division: string;
  /** Official record off LeagueLineup's standings table. Not derivable from
   *  the games: MI and ME play crossover games that count in neither
   *  division, so recomputing inflates every Division I record. */
  w?: number; l?: number; t?: number;
}
interface Game {
  id: string; date: string; time: string; field: string;
  away: string; home: string; division: string;
  status: string; awayScore: number | null; homeScore: number | null;
}
interface StandingRow { team: string; w: number; l: number; t: number; pct: string; rf: number; ra: number }

async function main() {
  const verify = process.argv.includes("--verify");

  // 1. division ids
  const first = await get("standings");
  const divs = selectOptions(first, "DivisionID")
    .map(([id, code]) => ({ id, code }))
    .filter((d) => DIVISION_NAMES[d.code]);
  if (!divs.length) throw new Error("no divisions found — LeagueLineup markup changed?");
  divs.sort((a, b) => DIVISION_ORDER.indexOf(a.code) - DIVISION_ORDER.indexOf(b.code));
  console.log(`divisions: ${divs.map((d) => d.code).join(", ")}`);

  const teams = new Map<string, Team>();   // key: lowercased abbreviation
  const games: Game[] = [];
  const standings: Record<string, StandingRow[]> = {};
  const fields = new Set<string>();

  for (const d of divs) {
    const divName = DIVISION_NAMES[d.code]!;

    // 2. teams
    const teamsHtml = await get("teams", { divisionid: d.id });
    for (const [, abbr] of selectOptions(teamsHtml, "TeamID")) {
      if (!abbr || abbr === "All teams") continue;
      teams.set(abbr.toLowerCase(), {
        id: slugify(abbr),
        abbr,
        name: SPONSORS[abbr] ?? SPONSORS[Object.keys(SPONSORS).find((k) => k.toLowerCase() === abbr.toLowerCase()) ?? ""] ?? abbr,
        division: divName,
      });
    }

    // 3. standings — the league's OFFICIAL records, carried onto the team
    //    docs (see the Team.w comment for why they can't be recomputed).
    standings[d.code] = tableRows(await get("standings", { divisionid: d.id }))
      .filter((r) => r.length >= 8 && /^\d+$/.test(r[1]!))
      .map((r) => ({
        team: r[0]!, w: +r[1]!, l: +r[2]!, t: +r[3]!, pct: r[4]!, rf: +r[6]!, ra: +r[7]!,
      }));
    for (const row of standings[d.code]!) {
      const t = teams.get(row.team.toLowerCase());
      if (t) { t.w = row.w; t.l = row.l; t.t = row.t; }
      else console.log(`  warning: standings row "${row.team}" matches no team in ${d.code}`);
    }

    // 4. schedule — "All teams" carries the full division slate
    for (const r of tableRows(await get("schedules", { divisionid: d.id, teamid: 99999 }))) {
      // ['', day, m/d/yyyy, time, status, score, away, home, venue, umpires]
      if (r.length < 9 || !/^\d+\/\d+\/\d{4}$/.test(r[2] ?? "")) continue;
      const [, , date, time, status, score, away, home, venue] = r;
      const sc = /^(\d+)\s*-\s*(\d+)$/.exec((score ?? "").trim());
      if (venue) fields.add(venue);
      games.push({
        id: "", // assigned after de-dup, so ids stay stable in date order
        date: toIsoDate(date!),
        time: to24h(time!),
        field: venue ?? "",
        away: away!, home: home!,
        division: divName,
        // LeagueLineup: F = final, PPD = postponed, TBP = to be played
        status: sc ? "final" : status === "PPD" ? "postponed" : "scheduled",
        awayScore: sc ? Number(sc[1]) : null,
        homeScore: sc ? Number(sc[2]) : null,
      });
    }
    console.log(`  ${d.code.padEnd(3)} ${String(teams.size).padStart(3)} teams cumulative, ${games.length} game rows`);
  }

  // De-duplicate: a game appears under every division view sharing its field.
  const seen = new Set<string>();
  const unique = games
    .sort((a, b) => (a.date + a.time + a.home + a.away).localeCompare(b.date + b.time + b.home + b.away))
    .filter((g) => {
      const k = [g.date, g.time, g.home, g.away, g.field].join("|");
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  unique.forEach((g, i) => (g.id = `g-${String(i + 1).padStart(4, "0")}`));

  // Canonical casing: the division roster's spelling wins over the schedule's
  // (the schedule pages carry e.g. both "BrewJays" and "Brewjays").
  const teamId = (abbr: string): string => {
    const t = teams.get(abbr.toLowerCase());
    if (t) return t.id;
    // A team on the schedule but in no division dropdown — keep it, unnamed.
    const created: Team = {
      id: slugify(abbr), abbr,
      name: SPONSORS[abbr] ?? abbr,
      division: "",
    };
    teams.set(abbr.toLowerCase(), created);
    return created.id;
  };

  const played = unique.filter((g) => g.status === "final");
  console.log(
    `\n${teams.size} teams, ${unique.length} games (${played.length} final), ${fields.size} fields`
  );

  // Data-quality flags to take back to the league. These are faithfully
  // imported as-is — we don't silently "correct" the league's own records —
  // but they should be fixed at the source.
  //
  // Suspect start times: HSA plays 6:00 PM and 7:15 PM weeknight games. A
  // morning start is an AM/PM typo on their side, and because it sorts first
  // it leads the ticker as the next game up. (8/3/2026 1HitW vs DWBalls is
  // entered as "7:15 am".)
  const oddTimes = unique.filter((g) => g.time && g.time < "08:00");
  if (oddTimes.length) {
    console.log(`\nsuspect start times (AM/PM typo at the source, imported as-is):`);
    for (const g of oddTimes) {
      console.log(`  ${g.date} ${g.time} ${g.away} at ${g.home} (${g.division})`);
    }
  }

  const unnamed = [...teams.values()].filter((t) => t.name === t.abbr);
  if (unnamed.length) {
    console.log(`note: no sponsor name for ${unnamed.map((t) => t.abbr).join(", ")}`);
  }

  if (verify) verifyStandings(standings, unique, teams);

  /* ---------------- write ---------------- */
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const perDivision = new Map<string, number>();
  const teamRows = [...teams.values()]
    .sort((a, b) =>
      DIVISION_ORDER.indexOf(codeOf(a.division)) - DIVISION_ORDER.indexOf(codeOf(b.division)) ||
      a.abbr.localeCompare(b.abbr)
    )
    .map((t) => {
      const n = perDivision.get(t.division) ?? 0;
      perDivision.set(t.division, n + 1);
      return [
        t.id, teamDisplayName(t.name), t.abbr, t.division, teamColor(n),
        // Generated cap patches — see scripts/build-helena-team-logos.js.
        // Run that AFTER this script (it reads teams.csv) and before
        // provisioning, or the site links logos that aren't built yet.
        `/helena/teams/${t.id}.png`,
        t.w ?? "", t.l ?? "", t.t ?? "", teamSponsors(t.name),
      ];
    });
  fs.writeFileSync(
    path.join(OUT_DIR, "teams.csv"),
    csv(
      ["id", "name", "abbrev", "division", "color", "logo_url", "w", "l", "t", "sponsor"],
      teamRows
    )
  );

  const gameRows = unique.map((g) => [
    g.id, g.date, g.time, g.field, teamId(g.away), teamId(g.home), "", g.division,
    g.status, g.awayScore, g.homeScore,
  ]);
  fs.writeFileSync(
    path.join(OUT_DIR, "schedule.csv"),
    csv(
      ["id", "date", "time", "field", "away_team_id", "home_team_id", "week", "division", "status", "away_score", "home_score"],
      gameRows
    )
  );

  fs.writeFileSync(
    path.join(OUT_DIR, "provision.json"),
    JSON.stringify(provisionConfig([...fields].sort()), null, 2) + "\n"
  );

  console.log(`\nwrote ${OUT_DIR}/{teams.csv,schedule.csv,provision.json}`);
  console.log("next: npm run provision:emulator -- --config data/helena/provision.json");
}

function codeOf(divName: string): string {
  return Object.keys(DIVISION_NAMES).find((c) => DIVISION_NAMES[c] === divName) ?? "";
}

/** Sanity check: does recomputing W-L-T from the game results reproduce
 *  LeagueLineup's own standings table? Divergence means forfeits or manual
 *  adjustments the game rows don't carry. */
function verifyStandings(
  source: Record<string, StandingRow[]>,
  games: Game[],
  teams: Map<string, Team>
) {
  console.log("\n--- standings verification ---");
  let mismatches = 0;
  for (const [code, rows] of Object.entries(source)) {
    for (const row of rows) {
      let w = 0, l = 0, t = 0;
      for (const g of games) {
        if (g.status !== "final") continue;
        const isHome = g.home.toLowerCase() === row.team.toLowerCase();
        const isAway = g.away.toLowerCase() === row.team.toLowerCase();
        if (!isHome && !isAway) continue;
        const us = isHome ? g.homeScore! : g.awayScore!;
        const them = isHome ? g.awayScore! : g.homeScore!;
        if (us > them) w++; else if (us < them) l++; else t++;
      }
      if (w !== row.w || l !== row.l || t !== row.t) {
        mismatches++;
        console.log(
          `  ${code} ${row.team}: LeagueLineup ${row.w}-${row.l}-${row.t}, derived ${w}-${l}-${t}`
        );
      }
    }
  }
  console.log(mismatches ? `${mismatches} teams differ (forfeits / manual adjustments)` : "all teams match");
  void teams;
}

function provisionConfig(fields: string[]) {
  return {
    league: {
      slug: "helena",
      name: "Helena Softball Association",
      abbrev: "HSA",
      sport: "softball",
      // Adult slowpitch: 7 innings, one game a night.
      innings: 7,
      ruleset: "slowpitch",
      linescore_innings: 7,
      // Stats OFF at launch. LeagueLineup published no box scores for HSA —
      // only final scores — so there is nothing to import. Turn these on if
      // the league starts collecting them through the captain portal.
      stat_columns: [] as string[],
      pitching: { tracked: false },
      rules_flags: { dropped_third_strike: false, balks: false, infield_fly: false },
      // Stats-off, so /standings shows the league's OWN W-L-T (imported onto
      // the team docs) instead of recomputing. Required here: Division I and
      // Division E play crossover games that count in neither division's
      // standings, so a recomputed table would credit Division I teams with
      // four extra wins apiece. Same path COYBL uses.
      flags: { stats_enabled: false },
      // Montana evergreen + copper. Reads against the light platform layout
      // and matches the state's mining-country palette rather than a generic
      // ballpark navy.
      theme: {
        primary: "#124734",
        accent: "#b4622d",
        secondary: "#e0a83c",
        // HSA has no logo of its own — these are generated by
        // scripts/build-helena-brand.js. Replace them the moment the league
        // sends real artwork.
        logo_url: "/helena/logo.png",
        banner_url: "/helena/banner.png",
        // MUST be set. The platform default /og-default.png is SFBL's logo,
        // so without this every Helena link texts out an SFBL share card.
        og_image_url: "/helena/og.png",
      },
      billing: {
        status: "trial",
        paid_through: null,
        last_payment: null,
        notes: "Prospect — migrated off LeagueLineup for the pitch",
      },
      fields,
      // Captains reach the portal by picking their team and typing the team
      // code (seeded to teams/{id}/_private/auth by seed-helena-extras.ts).
      // No email sign-in — a slowpitch captain will not do a magic-link dance
      // standing at the field with a scorebook.
      captain: { passwordless: true },
      // HSA publishes W-L-T with Pct and GB, no points table.
      standings: { scoring: "pct", tiebreaker: "rd" },
      // Homepage welcome blurb.
      about:
        "Adult slowpitch softball for Lewis & Clark, Jefferson, and Broadwater " +
        "Counties. Men's, women's, and coed leagues play Monday through Friday " +
        "nights at the Batch and Centennial complexes in Helena.",
      // Nav: hide every default link this tenant has no data behind, so the
      // menu never leads to an empty page. HSA runs no player stats, no
      // photo gallery, no online payment, no store, and its playoffs are
      // city/state tournaments run outside the league schedule.
      nav: {
        hide: [
          // The stock league-identity dropdown (Info / Rules / Fields). It is
          // labelled "SFBL" in DEFAULT_LINKS and matched here BEFORE the
          // relabel-to-tenant-short step, so "SFBL" is the right string.
          // Replaced by the "League" dropdown in `add` below, which points at
          // HSA's own pages and drops Rules (the league hands rules out on
          // paper at registration — there is nothing to publish).
          "SFBL",
          "Contact",            // lives in the League dropdown instead
          "Stats",              // stats_enabled=false — no box scores exist
          "Team Stats",
          "Player of the Week",
          "Availability",
          "Photos",
          "Tournaments",        // city/state tourneys are run outside the league schedule
          "History",
          "Pay Online",
          "Store",
          "News",
          "Player Registration",
          "Team Registration",  // registration is in person at the Legion hall
          "Team Waiver",
          "Register",
          "Umpire Evaluation",
        ],
        add: [
          {
            label: "League",
            href: "#",
            children: [
              { label: "League Info", href: "/content/hsa-info" },
              { label: "Forms & Documents", href: "/content/forms" },
              { label: "Our Sponsors", href: "/content/sponsors" },
              { label: "Rainout Alerts", href: "/alerts" },
              { label: "Fields", href: "/fields" },
              { label: "Contact", href: "/content/contact" },
            ],
          },
        ],
      },
    },
    teams_csv: "./teams.csv",
    schedule_csv: "./schedule.csv",
    admins: ["adam.miller.22@gmail.com"],
  };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
