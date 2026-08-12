// Seed a league with SAMPLE teams, games and results so visitors can see what
// Scores, Schedule, Standings, Teams and the ticker look like before the real
// season starts. Mike asked for this for Island's launch (via Adam, 2026-08-12).
//
//   SA_PATH=… TENANT=island npx tsx scripts/seed-demo-season.ts            (dry run)
//   SA_PATH=… TENANT=island WRITE=1 npx tsx scripts/seed-demo-season.ts    (seed)
//   SA_PATH=… TENANT=island WRITE=1 REMOVE=1 npx tsx scripts/seed-demo-season.ts
//
// TWO THINGS MAKE THIS SAFE TO PUT ON A LIVE SITE.
//
// 1. Every document written carries `demo: true`, and removal deletes on that
//    field alone. It cannot take a real team with it, no matter what has been
//    registered in the meantime.
// 2. It sets flags.demo_data, which is what renders the "Sample data" banner
//    on those pages. Seeding and the warning are the same operation, so the
//    data can never be live without the warning — realistic fake results with
//    nothing saying so is how a parent concludes the season already started.
//
// Results are fixed, not random: the standings table should look the same to
// everyone who screenshots it, and re-running must not silently reshuffle it.

import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { readFileSync, existsSync } from "node:fs";

const SA_PATH = process.env.SA_PATH;
const TENANT = process.env.TENANT;
const WRITE = process.env.WRITE === "1";
const REMOVE = process.env.REMOVE === "1";

if (!SA_PATH || !existsSync(SA_PATH)) {
  console.error("SA_PATH must point at a service-account JSON file.");
  process.exit(1);
}
if (!TENANT || !/^[a-z][a-z0-9-]*$/.test(TENANT)) {
  console.error("TENANT is required, e.g. TENANT=island");
  process.exit(1);
}

const sa = JSON.parse(readFileSync(SA_PATH, "utf8")) as { project_id: string };
initializeApp({ credential: cert(SA_PATH), projectId: sa.project_id });
const db = getFirestore();

// Names are obviously placeholders on purpose. Real-sounding Long Island club
// names would be mistaken for real teams, and worse, could collide with a club
// that actually registers.
const TEAMS = [
  { id: "demo-10u-a", name: "Sample Team A", abbrev: "STA", ageGroup: "10U", division: "Weekend", ageOrder: 10, color: "#0b2e4f" },
  { id: "demo-10u-b", name: "Sample Team B", abbrev: "STB", ageGroup: "10U", division: "Weekend", ageOrder: 10, color: "#8c1d2c" },
  { id: "demo-12u-a", name: "Sample Team C", abbrev: "STC", ageGroup: "12U", division: "Weekend", ageOrder: 12, color: "#14532d" },
  { id: "demo-12u-b", name: "Sample Team D", abbrev: "STD", ageGroup: "12U", division: "Weekend", ageOrder: 12, color: "#4c1d95" },
  { id: "demo-14u-a", name: "Sample Team E", abbrev: "STE", ageGroup: "14U", division: "Weeknight", ageOrder: 14, color: "#9a3412" },
  { id: "demo-14u-b", name: "Sample Team F", abbrev: "STF", ageGroup: "14U", division: "Weeknight", ageOrder: 14, color: "#155e75" },
];

// A mix of played and upcoming, so Scores has finals, Schedule has fixtures,
// and Standings has something to compute. Dates sit inside the real Fall
// window so the season-week grouping puts them where a coach expects.
const GAMES = [
  { id: "demo-g1", date: "2026-09-13", time: "09:00", home: "demo-10u-a", away: "demo-10u-b", hs: 7, as: 4, field: "Sample Field 1" },
  { id: "demo-g2", date: "2026-09-13", time: "12:30", home: "demo-12u-b", away: "demo-12u-a", hs: 3, as: 8, field: "Sample Field 2" },
  { id: "demo-g3", date: "2026-09-16", time: "18:00", home: "demo-14u-a", away: "demo-14u-b", hs: 5, as: 5, field: "Sample Field 1" },
  { id: "demo-g4", date: "2026-09-20", time: "09:00", home: "demo-10u-b", away: "demo-10u-a", hs: 6, as: 2, field: "Sample Field 1" },
  { id: "demo-g5", date: "2026-09-20", time: "12:30", home: "demo-12u-a", away: "demo-12u-b", hs: 11, as: 1, field: "Sample Field 3" },
  { id: "demo-g6", date: "2026-09-23", time: "18:00", home: "demo-14u-b", away: "demo-14u-a", hs: 4, as: 9, field: "Sample Field 2" },
  // Upcoming — no scores, so Schedule and the ticker have fixtures to show.
  { id: "demo-g7", date: "2026-09-27", time: "09:00", home: "demo-10u-a", away: "demo-10u-b", field: "Sample Field 1" },
  { id: "demo-g8", date: "2026-09-27", time: "12:30", home: "demo-12u-a", away: "demo-12u-b", field: "Sample Field 2" },
  { id: "demo-g9", date: "2026-09-30", time: "18:00", home: "demo-14u-a", away: "demo-14u-b", field: "Sample Field 1" },
] as { id: string; date: string; time: string; home: string; away: string; hs?: number; as?: number; field: string }[];

async function remove() {
  let n = 0;
  for (const coll of ["teams", "games"] as const) {
    const snap = await db.collection(`leagues/${TENANT}/${coll}`).where("demo", "==", true).get();
    console.log(`${coll}: ${snap.size} demo docs`);
    if (!WRITE) continue;
    for (const d of snap.docs) {
      await d.ref.delete();
      n++;
    }
  }
  if (WRITE) {
    await db.doc(`leagues/${TENANT}`).set({ flags: { demo_data: false } }, { merge: true });
    console.log(`removed ${n} docs, flags.demo_data = false`);
  } else {
    console.log("dry run — re-run with WRITE=1 to delete");
  }
}

async function seed() {
  console.log(`${WRITE ? "SEEDING" : "DRY RUN"} — ${TEAMS.length} teams, ${GAMES.length} games`);
  for (const t of TEAMS) {
    console.log(`  team ${t.name} (${t.ageGroup} ${t.division})`);
    if (!WRITE) continue;
    await db.doc(`leagues/${TENANT}/teams/${t.id}`).set({
      name: t.name,
      abbrev: t.abbrev,
      ageGroup: t.ageGroup,
      division: t.division,
      ageOrder: t.ageOrder,
      divOrder: 1,
      color: t.color,
      logo_url: null,
      // No stored w/l on purpose: standings compute from games, and a stored
      // record is what freezes a league's table (see reference on that).
      demo: true,
      created_by: "seed-demo-season",
    });
  }
  for (const g of GAMES) {
    const played = g.hs !== undefined;
    console.log(`  game ${g.date} ${g.home} v ${g.away}${played ? ` ${g.hs}-${g.as}` : " (upcoming)"}`);
    if (!WRITE) continue;
    await db.doc(`leagues/${TENANT}/games/${g.id}`).set({
      date: g.date,
      time: g.time,
      home_team_id: g.home,
      away_team_id: g.away,
      ...(played ? { home_score: g.hs, away_score: g.as, status: "final" } : { status: "scheduled" }),
      field: g.field,
      division: TEAMS.find((t) => t.id === g.home)?.division ?? "",
      demo: true,
    });
  }
  if (WRITE) {
    await db.doc(`leagues/${TENANT}`).set({ flags: { demo_data: true } }, { merge: true });
    console.log("\nflags.demo_data = true — the 'Sample data' banner is now showing");
  } else {
    console.log("\ndry run — re-run with WRITE=1 to seed");
  }
}

(REMOVE ? remove() : seed()).then(() => process.exit(0));
