// One-off importer: read the old SFBL Next.js site at
// ~/Desktop/sfbl/src/lib/{teams,games}.ts and emit
// data/sfbl/{teams,schedule}.csv + data/sfbl/provision.json shaped
// for `npm run provision`. Companion to scripts/scrape-bgc-rosters.ts
// (which writes players.csv).
//
// Usage:
//   npx tsx scripts/import-sfbl-from-old-site.ts
//
// We read the source TS files as text and use the Function constructor
// to evaluate the array literal — the source repo isn't a dependency
// (different tsconfig / type imports), so an import would 500 on
// missing types. Our own data, our risk; the inputs are paths we
// control.

import * as fs from "node:fs";
import * as path from "node:path";

const SOURCE_DIR = "/Users/AdamMiller/Desktop/sfbl/src/lib";
const OUT_DIR = path.resolve(process.cwd(), "data/sfbl");

interface OldTeam {
  id: string;
  name: string;
  abbr: string;
  division: "18+" | "28+" | "35+";
  subDivision?: "American" | "National";
  color: string;
  color2?: string;
  logo?: string;
}

interface OldGame {
  id: string;
  date: string;
  time: string;
  field: string;
  division: "18+" | "28+" | "35+";
  awayTeam: string;
  homeTeam: string;
  awayScore: number | null;
  homeScore: number | null;
  status: "scheduled" | "final" | "in_progress" | "postponed";
}

function evalArrayLiteralFrom(filePath: string, exportName: string): unknown {
  const text = fs.readFileSync(filePath, "utf8");
  // Strip type-import lines + ": Type[]" annotations so the literal
  // parses as plain JS. The data uses no fancy expressions.
  const stripped = text
    .replace(/^import[^\n]*\n/gm, "")
    .replace(new RegExp(`:\\s*\\w+\\[\\]\\s*=`), " =");
  const idx = stripped.indexOf(`export const ${exportName}`);
  if (idx < 0)
    throw new Error(`${exportName} not found in ${filePath}`);
  const eqIdx = stripped.indexOf("=", idx);
  if (eqIdx < 0) throw new Error("malformed export");
  // Find the matching ]; that closes the literal. Walk through brackets
  // counting depth.
  const after = stripped.slice(eqIdx + 1);
  let depth = 0;
  let end = -1;
  for (let i = 0; i < after.length; i++) {
    const c = after[i]!;
    if (c === "[") depth++;
    else if (c === "]") {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end < 0) throw new Error(`couldn't find ] for ${exportName}`);
  const literal = after.slice(0, end);
  // Function-construct a return so we get a real value back, not eval'd
  // in the global scope.
  return new Function(`"use strict"; return ${literal};`)();
}

function csvEscape(v: string | number | null | undefined): string {
  if (v == null) return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// ── teams ────────────────────────────────────────────────────────

function buildTeamsCsv(teams: OldTeam[]): string {
  const header = "id,name,abbrev,division,color,logo_url";
  const rows = [header];
  for (const t of teams) {
    // Flatten 35+ sub-divisions into a single "division" string
    // ("35+ American") so the existing single-column schema can group
    // by it. 18+ and 28+ stay simple ("18+", "28+").
    const division = t.subDivision
      ? `${t.division} ${t.subDivision}`
      : t.division;
    // Old slugs use kebab-case ("miami-yankees"), which the provision
    // script's isoSlug regex (^[a-z0-9][a-z0-9_-]*$) already accepts.
    rows.push(
      [
        csvEscape(t.id),
        csvEscape(t.name),
        csvEscape(t.abbr),
        csvEscape(division),
        csvEscape(t.color),
        csvEscape(`/logos/sfbl/${path.basename(t.logo ?? "")}`),
      ].join(","),
    );
  }
  return rows.join("\n") + "\n";
}

// ── schedule ─────────────────────────────────────────────────────

/** "9:30 AM" / "12:45 PM" / "TBD" → "09:30" / "12:45" / "" */
function to24h(s: string): string {
  const t = (s ?? "").trim();
  if (!t || /^TBD$/i.test(t)) return "";
  const m = t.match(/^(\d{1,2}):(\d{2})\s*([AaPp])[Mm]?$/);
  if (!m) {
    // Already 24h or unrecognized — pass through if it matches HH:MM.
    return /^\d{1,2}:\d{2}$/.test(t)
      ? t.padStart(5, "0")
      : "";
  }
  const [, hStr, mStr, ampm] = m;
  let h = parseInt(hStr!, 10);
  if (/[Pp]/.test(ampm!)) {
    if (h !== 12) h += 12;
  } else {
    if (h === 12) h = 0;
  }
  return `${String(h).padStart(2, "0")}:${mStr}`;
}

function buildScheduleCsv(games: OldGame[]): string {
  // Includes status + scores so the provision script can hydrate
  // historical finals (provision.ts reads these as optional columns;
  // missing fields default to scheduled / 0-0).
  const header =
    "id,date,time,field,away_team_id,home_team_id,week,division,status,away_score,home_score";
  const rows = [header];
  // Games are imported with their existing scores + status. Final
  // games stay final, scheduled stay scheduled, postponed stay
  // postponed. Our standings calc + audit script understand all
  // three. We don't have a `week` field in the source, so we leave
  // it blank — the schedule view already groups by date via
  // lib/season-weeks.computeWeeks() so the WK selector works.
  for (const g of games) {
    rows.push(
      [
        csvEscape(g.id),
        csvEscape(g.date),
        csvEscape(to24h(g.time)),
        csvEscape(g.field === "TBD" ? "" : g.field),
        csvEscape(g.awayTeam),
        csvEscape(g.homeTeam),
        "", // week — derived at render time
        csvEscape(g.division),
        csvEscape(g.status),
        csvEscape(g.awayScore),
        csvEscape(g.homeScore),
      ].join(","),
    );
  }
  return rows.join("\n") + "\n";
}

// ── provision.json ───────────────────────────────────────────────

function buildProvisionJson(): string {
  const config = {
    league: {
      slug: "sfbl",
      name: "South Florida Baseball League",
      abbrev: "SFBL",
      sport: "baseball",
      innings: 9,
      ruleset: "hardball",
      linescore_innings: 9,
      stat_columns: [
        "AB",
        "R",
        "H",
        "2B",
        "3B",
        "HR",
        "RBI",
        "BB",
        "SO",
        "SB",
      ],
      pitching: {
        tracked: true,
        columns: ["IP", "H", "R", "ER", "BB", "SO", "HR"],
      },
      rules_flags: {
        // Per sfbl.com/sfbl-rules: hit-batter-counts (4 in a game →
        // pitcher removed; 12 in a season → suspended). The current
        // schema doesn't have a dedicated flag for that — the rules
        // page covers it textually.
        dropped_third_strike: true,
        balks: true,
        infield_fly: true,
      },
      theme: {
        primary: "#0c2340", // Yankees navy — common SFBL palette anchor
        accent: "#c41e3a", // Cardinals red — pops on the navy
        logo_url: "/logos/sfbl/sfbl-logo.png",
      },
      billing: {
        status: "active",
        paid_through: null,
        last_payment: null,
        notes: "Phase 1 launch — manual billing",
      },
      standings: {
        scoring: "points",
        // Per sfbl.com/sfbl-rules tie-breaker logic: PCT first;
        // head-to-head and net-runs are v1 work. For MVP we keep
        // PCT-based standings with run-diff as the secondary sort.
        points_per: { win: 2, tie: 1, loss: 0 },
        tiebreaker: "pct",
      },
    },
    teams_csv: "./teams.csv",
    players_csv: "./players.csv",
    schedule_csv: "./schedule.csv",
    admins: ["adam.miller.22@gmail.com"],
  };
  return JSON.stringify(config, null, 2) + "\n";
}

// ── main ─────────────────────────────────────────────────────────

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const teams = evalArrayLiteralFrom(
    path.join(SOURCE_DIR, "teams.ts"),
    "TEAMS",
  ) as OldTeam[];
  const games = evalArrayLiteralFrom(
    path.join(SOURCE_DIR, "games.ts"),
    "GAMES",
  ) as OldGame[];

  console.log(`[import] Read ${teams.length} teams, ${games.length} games`);

  fs.writeFileSync(path.join(OUT_DIR, "teams.csv"), buildTeamsCsv(teams));
  fs.writeFileSync(
    path.join(OUT_DIR, "schedule.csv"),
    buildScheduleCsv(games),
  );
  fs.writeFileSync(
    path.join(OUT_DIR, "provision.json"),
    buildProvisionJson(),
  );

  console.log(`[import] Wrote teams.csv (${teams.length} rows)`);
  console.log(`[import] Wrote schedule.csv (${games.length} rows)`);
  console.log(`[import] Wrote provision.json`);
  console.log(
    `[import] Run players-csv separately:\n  npx tsx scripts/scrape-bgc-rosters.ts`,
  );
}

main();
