// Hydrate the Helena tenant's non-CSV content: venue addresses and the
// commissioner-managed content pages.
//
// Split out from scrape-helena.ts because none of this comes off
// LeagueLineup — HSA's own site lists venues as bare names with no address
// ("The administrator of this League has not provided an address for this
// venue" on every one), and the page copy is assembled from their About /
// Contact / handouts pages plus the season announcements.
//
// Usage:
//   FIRESTORE_EMULATOR_HOST=localhost:8080 GCLOUD_PROJECT=league-platform-5f3c8 \
//     npx tsx scripts/seed-helena-extras.ts
//
// Writes:
//   /leagues/helena/site_config/fields         { data: [{name, address}] }
//   /leagues/helena/page_content/{hsa-info,contact,forms}

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";
import { seedSlots } from "../lib/bracket-generator";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const LEAGUE = "helena";
const PAGES_DIR = path.resolve(process.cwd(), "data/helena/pages");

// Addresses verified against the City of Helena parks listings and mapping
// data (2026-07-30) — HSA publishes none. Both complexes are city parks;
// the parks office line is 406-447-8463.
const FIELDS = [
  { name: "Batch 1", address: "Batch Fields, 2101 N Benton Ave, Helena, MT 59601" },
  { name: "Batch 2", address: "Batch Fields, 2101 N Benton Ave, Helena, MT 59601" },
  { name: "Batch 3", address: "Batch Fields, 2101 N Benton Ave, Helena, MT 59601" },
  { name: "Batch 4", address: "Batch Fields, 2101 N Benton Ave, Helena, MT 59601" },
  { name: "CENT 1", address: "Centennial Park, 1200 N Last Chance Gulch, Helena, MT 59601" },
  { name: "CENT 2", address: "Centennial Park, 1200 N Last Chance Gulch, Helena, MT 59601" },
  { name: "CENT 3", address: "Centennial Park, 1200 N Last Chance Gulch, Helena, MT 59601" },
];

const PAGES = ["hsa-info", "contact", "forms"];

/** Minimal CSV reader — the files are written by scrape-helena.ts, so the only
 *  quoting we ever have to handle is the double-quoted comma. */
function readCsv(file: string): Array<Record<string, string>> {
  const lines = fs.readFileSync(file, "utf8").trim().split("\n");
  const head = splitRow(lines[0]!);
  return lines.slice(1).map((line) => {
    const cells = splitRow(line);
    const row: Record<string, string> = {};
    head.forEach((h, i) => (row[h] = cells[i] ?? ""));
    return row;
  });
}
function splitRow(line: string): string[] {
  const out: string[] = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

/** The sponsors page, built from teams.csv so it can never drift from the
 *  team docs. Grouped by business, because a business that buys two teams
 *  wants to see itself once with both. */
function sponsorsMarkdown(teams: Array<Record<string, string>>): string {
  const byBusiness = new Map<string, string[]>();
  for (const t of teams) {
    for (const name of (t.sponsor ?? "").split("/").map((x) => x.trim()).filter(Boolean)) {
      if (!byBusiness.has(name)) byBusiness.set(name, []);
      byBusiness.get(name)!.push(t.name!);
    }
  }
  const sorted = [...byBusiness.entries()].sort((a, b) =>
    a[0].localeCompare(b[0], "en", { sensitivity: "base" }),
  );
  const lines = [
    "# Our Sponsors",
    "",
    `Adult softball in Helena runs on local businesses. **${sorted.length} of them** back a`,
    "team in the 2026 season, covering jerseys, softballs, and umpires so the league can keep",
    "team fees where they are.",
    "",
    "If your business wants a team next season, talk to any board member on the Contact page.",
    "",
    "## 2026 season sponsors",
    "",
    "| Sponsor | Team |",
    "| --- | --- |",
    ...sorted.map(([biz, teamNames]) => `| ${biz} | ${teamNames.sort().join(", ")} |`),
    "",
    "Sponsor names come from the league's official Key to Abbreviations for the 2026 season.",
    "Spot an error or a missing business? Let the board know and it will be corrected here.",
  ];
  return lines.join("\n") + "\n";
}

/** Per-team captain passwords.
 *
 *  Without one, /api/public-captain-claim falls back to accepting the team's
 *  own name / id / abbrev — i.e. anyone who can read the site can claim any
 *  team and post scores as them. Fine for a league where the commissioner
 *  knows every captain; not fine for a live demo we hand to a prospect.
 *
 *  The password is written to the PRIVATE subdoc teams/{id}/_private/auth,
 *  with a non-secret `has_captain_password` marker on the public doc — the
 *  public team doc is world-readable, so the password itself must never sit
 *  there. Codes are written to a file OUTSIDE the repo so they never land in
 *  git.
 */
function makeCode(abbrev: string): string {
  const word = abbrev.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 10) || "team";
  const n = crypto.randomInt(1000, 10000);
  return `${word}${n}`;
}

/** Preview postseason bracket.
 *
 *  HSA's actual postseason is the State Coed "D" & "E" tournament and the
 *  Men's Rec City tournament — the league has published neither field nor
 *  dates, so NOTHING here is presented as a real matchup. The bracket is
 *  seeded strictly from the league's own final regular-season standings and
 *  the title says "preview" on it. Round one carries real teams at real
 *  seeds; later rounds are left empty rather than predicting winners.
 *
 *  Delete this (set active:false) or replace it with the real field the
 *  moment HSA hands over their tournament draw.
 */
const BRACKET_DIVISIONS = ["Coed White", "Coed Blue"];
const BRACKET_SIZE = 8;

function buildBracket(teams: Array<Record<string, string>>) {
  const divisions = BRACKET_DIVISIONS.map((label) => {
    const seeded = teams
      .filter((t) => t.division === label && t.w !== "" && t.l !== "")
      .map((t) => {
        const w = Number(t.w), l = Number(t.l), tie = Number(t.t || 0);
        const gp = w + l + tie;
        return { id: t.id!, pct: gp ? (w + 0.5 * tie) / gp : 0, w, l };
      })
      .sort((a, b) => b.pct - a.pct || b.w - a.w || a.l - b.l)
      .slice(0, BRACKET_SIZE);

    // 1v8, 4v5, 3v6, 2v7 — standard single-elim seed order.
    const order = seedSlots(BRACKET_SIZE);
    const first = [];
    for (let i = 0; i < order.length; i += 2) {
      const hi = seeded[order[i]! - 1];
      const lo = seeded[order[i + 1]! - 1];
      first.push({
        id: `${label.toLowerCase().replace(/\W+/g, "-")}-qf${first.length + 1}`,
        home_team_id: hi?.id ?? null,
        home_seed: order[i]!,
        away_team_id: lo?.id ?? null,
        away_seed: order[i + 1]!,
        game_id: null,
        home_score: null,
        away_score: null,
        winner_team_id: null,
        status: "scheduled" as const,
      });
    }
    const empty = (prefix: string, n: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: `${label.toLowerCase().replace(/\W+/g, "-")}-${prefix}${i + 1}`,
        home_team_id: null, home_seed: null,
        away_team_id: null, away_seed: null,
        game_id: null, home_score: null, away_score: null,
        winner_team_id: null, status: "scheduled" as const,
      }));

    return {
      label,
      rounds: [
        { label: "Quarterfinals", matches: first },
        { label: "Semifinals", matches: empty("sf", 2) },
        { label: "Championship", matches: empty("final", 1) },
      ],
    };
  });

  return {
    active: true,
    title: "2026 Postseason — Preview Bracket",
    note:
      "Seeded from final regular-season standings. Not the league's official " +
      "tournament draw — the State Coed D & E and Men's Rec City tournament " +
      "fields are set by the board.",
    divisions,
  };
}

function db() {
  const useEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
  const projectId = useEmulator
    ? process.env.GCLOUD_PROJECT || "demo-provision"
    : process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!projectId) throw new Error("no project id resolved");
  if (useEmulator) {
    initializeApp({ projectId });
    console.log(`[helena-extras] emulator ${process.env.FIRESTORE_EMULATOR_HOST}`);
  } else {
    const key = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
    const email = process.env.FIREBASE_CLIENT_EMAIL;
    if (!key || !email) throw new Error("missing FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY");
    initializeApp({ credential: cert({ projectId, clientEmail: email, privateKey: key }) });
    console.log(`[helena-extras] LIVE project ${projectId}`);
  }
  return getFirestore();
}

async function main() {
  const store = db();

  await store.doc(`leagues/${LEAGUE}/site_config/fields`).set(
    { data: FIELDS, updated_at: new Date().toISOString() },
    { merge: true },
  );
  console.log(`[helena-extras] fields: ${FIELDS.length} venues`);

  // Sponsor credit onto each team doc, and the generated sponsors page.
  const teams = readCsv(path.resolve(process.cwd(), "data/helena/teams.csv"));
  let sponsored = 0;
  for (const t of teams) {
    if (!t.sponsor) continue;
    await store.doc(`leagues/${LEAGUE}/teams/${t.id}`).set(
      { sponsor: t.sponsor, updated_at: new Date().toISOString() },
      { merge: true },
    );
    sponsored++;
  }
  console.log(`[helena-extras] sponsor credit on ${sponsored}/${teams.length} teams`);

  const sponsorsMd = sponsorsMarkdown(teams);
  fs.writeFileSync(path.join(PAGES_DIR, "sponsors.md"), sponsorsMd);
  await store.doc(`leagues/${LEAGUE}/page_content/sponsors`).set(
    {
      markdown: sponsorsMd,
      updated_at: new Date().toISOString(),
      updated_by_uid: "seed-script",
    },
    { merge: true },
  );
  console.log("[helena-extras] page_content/sponsors (generated from teams.csv)");

  // Captain access
  const codes: Array<[string, string, string]> = [];
  for (const t of teams) {
    const code = makeCode(t.abbrev || t.id!);
    await store.doc(`leagues/${LEAGUE}/teams/${t.id}/_private/auth`).set(
      { captain_password: code, updated_at: new Date().toISOString() },
      { merge: true },
    );
    await store.doc(`leagues/${LEAGUE}/teams/${t.id}`).set(
      { has_captain_password: true, updated_at: new Date().toISOString() },
      { merge: true },
    );
    codes.push([t.name!, t.division!, code]);
  }
  const codeDir = path.join(os.homedir(), ".helena-demo");
  fs.mkdirSync(codeDir, { recursive: true });
  const codeFile = path.join(codeDir, "captain-codes.txt");
  fs.writeFileSync(
    codeFile,
    "Helena Softball Association — captain codes\n" +
      "Team password for /captain. Keep out of the repo.\n\n" +
      codes
        .sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]))
        .map(([name, div, code]) => `${div.padEnd(20)} ${name.padEnd(34)} ${code}`)
        .join("\n") +
      "\n",
    { mode: 0o600 },
  );
  console.log(`[helena-extras] captain codes for ${codes.length} teams -> ${codeFile}`);

  const bracket = buildBracket(teams);
  await store.doc(`leagues/${LEAGUE}/site_config/playoffs`).set(
    { ...bracket, updated_at: new Date().toISOString() },
    { merge: true },
  );
  console.log(
    `[helena-extras] preview bracket: ${bracket.divisions
      .map((d) => `${d.label} (${d.rounds[0]!.matches.length} QF)`)
      .join(", ")}`,
  );

  for (const page of PAGES) {
    const file = path.join(PAGES_DIR, `${page}.md`);
    if (!fs.existsSync(file)) {
      console.error(`[helena-extras] missing ${file}`);
      process.exitCode = 1;
      continue;
    }
    await store.doc(`leagues/${LEAGUE}/page_content/${page}`).set(
      {
        markdown: fs.readFileSync(file, "utf8"),
        updated_at: new Date().toISOString(),
        updated_by_uid: "seed-script",
      },
      { merge: true },
    );
    console.log(`[helena-extras] page_content/${page}`);
  }

  console.log("[helena-extras] done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
