// Archive a live season to the static files the History page reads, so the
// live collections can then be cleared for the season that is starting.
//
// This is the step scripts/clear-season.ts tells you to do first:
//   data/<tenant>/historical-standings.json   final standings, by division
//   data/<tenant>/season-games-<year>.json    every game with a result
// Both are plain files in the repo, so they survive the clear-out completely
// and need no database to serve.
//
// Written for Island's Spring 2026 rollover but deliberately tenant-neutral:
// nothing below knows what "island" is. It reads teams and games out of
// leagues/<tenant> and writes the two files.
//
// Usage (writes nothing without WRITE=1):
//   SA_PATH=… TENANT=island SEASON="2026 Spring" npx tsx scripts/archive-season.ts
//   SA_PATH=… TENANT=island SEASON="2026 Spring" WRITE=1 npx tsx scripts/archive-season.ts
//
// Optional FROM / TO (YYYY-MM-DD) archive only part of the calendar, for a
// league that runs several seasons into one set of collections.

import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import * as path from "node:path";

const SA_PATH = process.env.SA_PATH;
const TENANT = process.env.TENANT;
const SEASON = process.env.SEASON;
const FROM = process.env.FROM ?? "";
const TO = process.env.TO ?? "";
const WRITE = process.env.WRITE === "1";

if (!SA_PATH || !existsSync(SA_PATH)) {
  console.error("SA_PATH must point at a service-account JSON file.");
  process.exit(1);
}
if (!TENANT || !/^[a-z][a-z0-9-]*$/.test(TENANT)) {
  console.error("TENANT is required, e.g. TENANT=island");
  process.exit(1);
}
if (!SEASON || !/\d{4}/.test(SEASON)) {
  // The History page pulls the year out of this string with /\d{4}/, and the
  // games filename is keyed on it, so a season label without a year would
  // produce an archive that cannot be found or sorted.
  console.error('SEASON is required and must contain a year, e.g. SEASON="2026 Spring"');
  process.exit(1);
}

const YEAR = /\d{4}/.exec(SEASON)![0];

const sa = JSON.parse(readFileSync(SA_PATH, "utf8")) as { project_id: string };
initializeApp({ credential: cert(SA_PATH), projectId: sa.project_id });
const db = getFirestore();

interface TeamRow {
  name: string;
  ageGroup: string;
  division: string;
  ageOrder: number;
}

/** Win percentage, ties counting as half a game — the usual convention. */
function pct(w: number, l: number, t: number): string {
  const g = w + l + t;
  if (!g) return ".000";
  return (Math.round(((w + t / 2) / g) * 1000) / 1000).toFixed(3).replace(/^0/, "");
}

async function main() {
  console.log(
    `project ${sa.project_id} · tenant ${TENANT} · season "${SEASON}" · ${WRITE ? "WRITING" : "DRY RUN"}`,
  );

  const [teamSnap, gameSnap] = await Promise.all([
    db.collection(`leagues/${TENANT}/teams`).get(),
    db.collection(`leagues/${TENANT}/games`).get(),
  ]);

  const teams = new Map<string, TeamRow>();
  for (const d of teamSnap.docs) {
    const x = d.data();
    teams.set(d.id, {
      name: String(x.name ?? d.id),
      ageGroup: String(x.ageGroup ?? ""),
      division: String(x.division ?? ""),
      ageOrder: typeof x.ageOrder === "number" ? x.ageOrder : 999,
    });
  }

  // ── games ────────────────────────────────────────────────────────────────
  // Only games with a real result. A scheduled-but-unplayed game in the
  // archive would show as a 0-0 forever.
  const games = gameSnap.docs
    .map((d) => d.data())
    .filter((x) => {
      const date = String(x.date ?? "");
      if (!date) return false;
      if (FROM && date < FROM) return false;
      if (TO && date > TO) return false;
      return x.home_score != null && x.away_score != null;
    })
    .map((x) => {
      const home = teams.get(String(x.home_team_id ?? ""));
      const away = teams.get(String(x.away_team_id ?? ""));
      return {
        date: String(x.date ?? ""),
        time: String(x.time ?? ""),
        // Age comes off the TEAM, not the game: Island's games carry only a
        // division ("Weekend"), and an archive that cannot tell 10U from 14U
        // is not worth keeping.
        ageGroup: home?.ageGroup ?? away?.ageGroup ?? "",
        division: String(x.division ?? home?.division ?? ""),
        home: home?.name ?? String(x.home_team_id ?? ""),
        away: away?.name ?? String(x.away_team_id ?? ""),
        home_score: Number(x.home_score),
        away_score: Number(x.away_score),
        status: String(x.status ?? "final"),
        field: x.field ? String(x.field) : null,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));

  // ── standings ────────────────────────────────────────────────────────────
  // Recomputed from the games rather than copied from each team's stored w/l.
  // Those stored numbers are exactly what goes stale, and five surfaces on
  // this platform have already been bitten by trusting them.
  const rec = new Map<string, { w: number; l: number; t: number }>();
  const bump = (id: string, k: "w" | "l" | "t") => {
    const r = rec.get(id) ?? { w: 0, l: 0, t: 0 };
    r[k] += 1;
    rec.set(id, r);
  };
  for (const d of gameSnap.docs) {
    const x = d.data();
    const date = String(x.date ?? "");
    if (!date) continue;
    if (FROM && date < FROM) continue;
    if (TO && date > TO) continue;
    if (x.home_score == null || x.away_score == null) continue;
    const h = String(x.home_team_id ?? "");
    const a = String(x.away_team_id ?? "");
    if (!teams.has(h) || !teams.has(a)) continue;
    const hs = Number(x.home_score);
    const as = Number(x.away_score);
    if (hs > as) {
      bump(h, "w");
      bump(a, "l");
    } else if (as > hs) {
      bump(a, "w");
      bump(h, "l");
    } else {
      bump(h, "t");
      bump(a, "t");
    }
  }

  // One block per age group + division, which is how these leagues are
  // actually organised ("14U Weekend"), rather than one flat table.
  const blocks = new Map<string, { ageOrder: number; rows: TeamRow[]; ids: string[] }>();
  for (const [id, t] of teams) {
    if (!rec.has(id)) continue; // never played in this window
    const label = [t.ageGroup, t.division].filter(Boolean).join(" ") || "League";
    const b = blocks.get(label) ?? { ageOrder: t.ageOrder, rows: [], ids: [] };
    b.rows.push(t);
    b.ids.push(id);
    blocks.set(label, b);
  }

  const standings = [...blocks.entries()]
    .sort((a, b) => a[1].ageOrder - b[1].ageOrder || a[0].localeCompare(b[0]))
    .map(([division, b]) => ({
      season: SEASON,
      game_type: "season",
      division,
      standings: b.ids
        .map((id) => {
          const r = rec.get(id)!;
          const g = r.w + r.l + r.t;
          return {
            team: teams.get(id)!.name,
            w: r.w,
            l: r.l,
            t: r.t,
            g,
            pct: pct(r.w, r.l, r.t),
            p: r.w * 2 + r.t,
          };
        })
        .sort((x, y) => Number(y.pct) - Number(x.pct) || y.w - x.w || x.team.localeCompare(y.team)),
    }));

  console.log(`teams ${teams.size} · archived games ${games.length}`);
  for (const s of standings) {
    console.log(`  ${s.division}: ${s.standings.length} teams`);
  }

  const dir = path.resolve(process.cwd(), `data/${TENANT}`);
  const standingsFile = path.join(dir, "historical-standings.json");
  const gamesFile = path.join(dir, `season-games-${YEAR}.json`);

  if (!WRITE) {
    console.log(`\nDRY RUN. Would write:\n  ${standingsFile}\n  ${gamesFile}`);
    console.log("Re-run with WRITE=1 to write them.");
    return;
  }

  mkdirSync(dir, { recursive: true });

  // Merge rather than overwrite: a tenant archiving its second season must not
  // lose its first.
  let existing: unknown[] = [];
  if (existsSync(standingsFile)) {
    try {
      const prev = JSON.parse(readFileSync(standingsFile, "utf8"));
      if (Array.isArray(prev)) {
        existing = prev.filter(
          (b) => (b as { season?: string })?.season !== SEASON,
        );
      }
    } catch {
      console.warn("existing historical-standings.json did not parse — starting fresh");
    }
  }

  writeFileSync(standingsFile, JSON.stringify([...existing, ...standings], null, 2) + "\n");
  writeFileSync(gamesFile, JSON.stringify(games, null, 2) + "\n");
  console.log(`\nWrote:\n  ${standingsFile}\n  ${gamesFile}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
