// One-stop fixture seed for local dev. Writes a complete tenant snapshot
// to a running emulator: league config, teams, games (with scores), and
// box scores. Idempotent — re-run to reset to known state.
//
// Usage: `npm run seed:fixture` (with dev:emulators already running)

import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error(
    "[seed-fixture] FIRESTORE_EMULATOR_HOST not set. Refusing to seed " +
      "fixture data without an explicit emulator target.",
  );
  process.exit(1);
}

const projectId =
  process.env.GCLOUD_PROJECT ??
  process.env.FIREBASE_PROJECT_ID ??
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ??
  "league-platform-5f3c8";

initializeApp({ projectId });
const db = getFirestore();

const LEAGUE_ID = "sfbl";

const LEAGUE_CONFIG = {
  slug: LEAGUE_ID,
  name: "South Florida Baseball",
  abbrev: "SFBL",
  sport: "baseball",
  innings: 9,
  ruleset: "hardball",
  linescore_innings: 9,
  stat_columns: ["AB", "R", "H", "2B", "3B", "HR", "RBI", "BB", "SO", "SB"],
  pitching: {
    tracked: true,
    columns: ["IP", "H", "R", "ER", "BB", "SO", "HR"],
  },
  rules_flags: { dropped_third_strike: true, balks: true, infield_fly: true },
  theme: { primary: "#0c1730", accent: "#f7c948", logo_url: "/logos/sfbl/sfbl-logo.png" },
  billing: {
    status: "active",
    paid_through: null,
    last_payment: null,
    notes: "fixture seed",
  },
  flags: {},
  // SFBL uses points-based standings. Confirmed from a screenshot of
  // their actual standings table: W=2, T=1, L=0; ties broken by PCT.
  standings: {
    scoring: "points",
    points_per: { win: 2, tie: 1, loss: 0 },
    tiebreaker: "pct",
  },
};

// Real SFBL teams + 3 age-based divisions (matches SFBL's actual division
// structure). Logos copied to /public/logos/sfbl/.
const TEAMS = [
  // 18+ Division
  { id: "wpb_cardinals",    name: "West Palm Beach Cardinals", abbrev: "WPBC", division: "18+ Division", color: "#a91e2c", logo: "wpb-cardinals.png" },
  { id: "miami_orioles",    name: "Miami Orioles",             abbrev: "ORI",  division: "18+ Division", color: "#df4601", logo: "miami-orioles.png" },
  { id: "margate_marlins",  name: "Margate Marlins",           abbrev: "MAR",  division: "18+ Division", color: "#0a8aaa", logo: "margate-marlins.png" },
  { id: "miami_buccaneers", name: "Miami Buccaneers",          abbrev: "BUCS", division: "18+ Division", color: "#a71930", logo: "miami-buccaneers.png" },
  // 28+ Division
  { id: "pb_pirates",       name: "Palm Beach Pirates",        abbrev: "PIR",  division: "28+ Division", color: "#000000", logo: "palm-beach-pirates.png" },
  { id: "sf_rays",          name: "South Florida Rays",        abbrev: "RAYS", division: "28+ Division", color: "#092c5c", logo: "sf-rays.png" },
  { id: "broward_yankees",  name: "Broward Yankees",           abbrev: "YANK", division: "28+ Division", color: "#0c2340", logo: "broward-yankees.png" },
  // 35+ American
  { id: "sf_astros",        name: "South Florida Astros",      abbrev: "ASTR", division: "35+ American", color: "#002d62", logo: "sf-astros.png" },
  { id: "miami_redsox",     name: "Miami Red Sox",             abbrev: "SOX",  division: "35+ American", color: "#bd3039", logo: "miami-red-sox.png" },
];

// Real-world-ish fixture: a few games among the 7 SFBL teams.
const GAMES = [
  // April — finals
  { id: "g1", home: "miami_orioles",    away: "miami_buccaneers", hs: 9, as: 3, status: "final",
    date: "2026-04-12T13:00:00-04:00", field: "Tropical Park 1" },
  { id: "g2", home: "wpb_cardinals",    away: "sf_rays",          hs: 7, as: 1, status: "final",
    date: "2026-04-12T16:00:00-04:00", field: "WPB Field 2" },
  { id: "g3", home: "margate_marlins",  away: "miami_orioles",    hs: 4, as: 2, status: "final",
    date: "2026-04-19T13:00:00-04:00", field: "Margate Park" },
  { id: "g4", home: "wpb_cardinals",    away: "broward_yankees",  hs: 8, as: 2, status: "final",
    date: "2026-04-19T16:00:00-04:00", field: "WPB Field 2" },
  { id: "g5", home: "margate_marlins",  away: "miami_orioles",    hs: 5, as: 5, status: "final",
    date: "2026-04-26T13:00:00-04:00", field: "Margate Park" }, // tie
  { id: "g6", home: "wpb_cardinals",    away: "miami_redsox",     hs: 6, as: 3, status: "final",
    date: "2026-04-26T16:00:00-04:00", field: "WPB Field 2" },
  { id: "g7", home: "margate_marlins",  away: "miami_redsox",     hs: 10, as: 0, status: "final",
    date: "2026-05-03T13:00:00-04:00", field: "Margate Park" },
  // May — scheduled
  { id: "g8",  home: "miami_orioles",   away: "sf_rays",          hs: 0, as: 0, status: "scheduled",
    date: "2026-05-10T13:00:00-04:00", field: "Tropical Park 1" },
  { id: "g9",  home: "margate_marlins", away: "wpb_cardinals",    hs: 0, as: 0, status: "scheduled",
    date: "2026-05-10T16:00:00-04:00", field: "Margate Park" },
  { id: "g10", home: "sf_rays",         away: "miami_redsox",     hs: 0, as: 0, status: "scheduled",
    date: "2026-05-17T13:00:00-04:00", field: "Plantation Field" },
  { id: "g11", home: "broward_yankees", away: "miami_buccaneers", hs: 0, as: 0, status: "scheduled",
    date: "2026-05-17T16:00:00-04:00", field: "Coral Springs" },
  // Draft (should not appear in standings)
  { id: "g_draft", home: "miami_orioles", away: "broward_yankees", hs: 99, as: 0, status: "draft",
    date: "2026-05-24T13:00:00-04:00", field: "Tropical Park 1" },
];

// Players. Each carries a team_id (primary team), jersey, position.
// recalcLeague will later attach `stats` and `pitching` subfields to
// these docs. Players who never appear in a box score still show up on
// their team's roster but have no stats line yet.
const PLAYERS = [
  // Margate Marlins
  { id: "p1_alice",  team_id: "margate_marlins",  name: "Alice Carter",     jersey: 7,  position: "P/SS" },
  { id: "p2_bob",    team_id: "margate_marlins",  name: "Bob Diaz",         jersey: 12, position: "C" },
  { id: "p3_carol",  team_id: "margate_marlins",  name: "Carol Esposito",   jersey: 24, position: "OF" },
  // Miami Orioles
  { id: "p4_dan",    team_id: "miami_orioles",    name: "Dan Forsyth",      jersey: 3,  position: "P/3B" },
  { id: "p5_emma",   team_id: "miami_orioles",    name: "Emma Greene",      jersey: 18, position: "OF" },
  // WPB Cardinals
  { id: "p6_frank",  team_id: "wpb_cardinals",    name: "Frank Hayes",      jersey: 10, position: "1B" },
  { id: "p7_grace",  team_id: "wpb_cardinals",    name: "Grace Iglesias",   jersey: 5,  position: "2B" },
  // SF Rays
  { id: "p8_henry",  team_id: "sf_rays",          name: "Henry Jameson",    jersey: 22, position: "SS" },
  { id: "p9_iris",   team_id: "sf_rays",          name: "Iris Khan",        jersey: 11, position: "OF" },
];

// Box scores for a couple of games. Drives the recalc smoke test.
const BOX_SCORES: Array<[string, Record<string, unknown>]> = [
  [
    "g1",
    {
      status: "final",
      home_team_id: "miami_orioles",
      away_team_id: "miami_buccaneers",
      home_score: 9,
      away_score: 3,
      // linescore: inning-by-inning runs. Length matches league.linescore_innings (9 for SFBL).
      linescore: {
        away: [0, 1, 0, 0, 0, 2, 0, 0, 0],
        home: [3, 0, 2, 1, 0, 1, 0, 2, 0],
      },
      hits: { away: 6, home: 11 },
      errors: { away: 2, home: 1 },
      away_lineup: [
        { player_id: "p1_alice", ab: 4, h: 3, doubles: 1, triples: 0, hr: 1, rbi: 3, bb: 0, so: 1, r: 2 },
        { player_id: "p2_bob", ab: 4, h: 1, doubles: 0, triples: 0, hr: 0, rbi: 0, bb: 0, so: 2, r: 0 },
        { player_id: "p3_carol", ab: 3, h: 0, doubles: 0, triples: 0, hr: 0, rbi: 0, bb: 1, so: 1, r: 1 },
      ],
      home_lineup: [
        { player_id: "p4_dan", ab: 5, h: 2, doubles: 1, triples: 0, hr: 0, rbi: 1, bb: 0, so: 0, r: 1 },
        { player_id: "p5_emma", ab: 4, h: 2, doubles: 0, triples: 0, hr: 1, rbi: 4, bb: 1, so: 1, r: 2 },
      ],
      away_pitchers: [
        { player_id: "p1_alice", ip_outs: 18, h: 7, r: 5, er: 5, bb: 2, so: 4, hr: 1, decision: "L" },
      ],
      home_pitchers: [
        { player_id: "p4_dan", ip_outs: 27, h: 4, r: 3, er: 2, bb: 1, so: 9, hr: 0, decision: "W" },
      ],
    },
  ],
  [
    "g2",
    {
      status: "final",
      home_team_id: "margate_marlins",
      away_team_id: "miami_orioles",
      home_score: 4,
      away_score: 2,
      linescore: {
        away: [0, 0, 1, 0, 0, 1, 0, 0, 0],
        home: [1, 0, 2, 0, 1, 0, 0, 0, 0],
      },
      hits: { away: 5, home: 7 },
      errors: { away: 1, home: 1 },
      away_lineup: [
        { player_id: "p4_dan", ab: 4, h: 1, doubles: 0, triples: 0, hr: 0, rbi: 1, bb: 0, so: 1, r: 0 },
        { player_id: "p5_emma", ab: 3, h: 0, doubles: 0, triples: 0, hr: 0, rbi: 0, bb: 1, so: 0, r: 0 },
      ],
      home_lineup: [
        { player_id: "p1_alice", ab: 4, h: 2, doubles: 0, triples: 0, hr: 0, rbi: 1, bb: 0, so: 0, r: 1 },
        { player_id: "p2_bob", ab: 3, h: 1, doubles: 1, triples: 0, hr: 0, rbi: 1, bb: 1, so: 0, r: 1 },
      ],
      away_pitchers: [
        { player_id: "p4_dan", ip_outs: 24, h: 6, r: 4, er: 3, bb: 2, so: 5, hr: 0, decision: "L" },
      ],
      home_pitchers: [
        { player_id: "p1_alice", ip_outs: 27, h: 4, r: 2, er: 1, bb: 0, so: 11, hr: 0, decision: "W" },
      ],
    },
  ],
];

async function run() {
  console.log(`[seed-fixture] writing to ${process.env.FIRESTORE_EMULATOR_HOST} (${projectId})`);

  // Wipe stale docs from previous fixture iterations so old team_ids
  // (e.g. team_foxes) don't linger as 0-0 mystery teams.
  for (const sub of ["teams", "games", "players", "box_scores"]) {
    const stale = await db.collection(`leagues/${LEAGUE_ID}/${sub}`).get();
    if (stale.empty) continue;
    const batch = db.batch();
    for (const d of stale.docs) batch.delete(d.ref);
    await batch.commit();
  }

  // League config
  await db.doc(`leagues/${LEAGUE_ID}`).set(LEAGUE_CONFIG);

  // Teams
  for (const t of TEAMS) {
    await db.doc(`leagues/${LEAGUE_ID}/teams/${t.id}`).set({
      name: t.name,
      abbrev: t.abbrev,
      division: t.division,
      color: t.color,
      logo_url: t.logo ? `/logos/sfbl/${t.logo}` : null,
    });
  }

  // Games
  for (const g of GAMES) {
    await db.doc(`leagues/${LEAGUE_ID}/games/${g.id}`).set({
      home_team_id: g.home,
      away_team_id: g.away,
      home_score: g.hs,
      away_score: g.as,
      status: g.status,
      date: g.date,
      field: g.field,
    });
  }

  // Players (uses .set with merge so recalc-written `stats` survive re-seeds)
  for (const p of PLAYERS) {
    await db.doc(`leagues/${LEAGUE_ID}/players/${p.id}`).set(
      {
        team_id: p.team_id,
        name: p.name,
        jersey: p.jersey,
        position: p.position,
      },
      { merge: true },
    );
  }

  // Box scores
  for (const [id, body] of BOX_SCORES) {
    await db.doc(`leagues/${LEAGUE_ID}/box_scores/${id}`).set(body);
  }

  console.log(
    `[seed-fixture] done — ${TEAMS.length} teams, ${PLAYERS.length} players, ${GAMES.length} games (1 draft), ${BOX_SCORES.length} box scores`,
  );
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[seed-fixture] failed:", err);
    process.exit(1);
  });
