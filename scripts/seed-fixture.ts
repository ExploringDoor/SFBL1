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
  theme: { primary: "#0c4a6e", accent: "#f59e0b" },
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

const TEAMS = [
  { id: "team_foxes", name: "Miami Foxes", division: "East" },
  { id: "team_sluggers", name: "Tampa Sluggers", division: "East" },
  { id: "team_bears", name: "Orlando Bears", division: "West" },
  { id: "team_eagles", name: "Jacksonville Eagles", division: "West" },
];

// Games: a small round-robin so standings show interesting variance.
// Status varies so we exercise the "ignore drafts" rule. Dates are
// stored as ISO 8601 strings — Firestore Timestamp would be cleaner
// long-term but strings are easier to seed/inspect.
//
// Upcoming games (status: scheduled) drive the /schedule page; final
// games drive both /standings and /scores.
const GAMES = [
  // Past games — final
  { id: "g1", home: "team_foxes", away: "team_sluggers", hs: 9, as: 3, status: "final",
    date: "2026-04-12T13:00:00-04:00", field: "Tropical Park 1" },
  { id: "g2", home: "team_sluggers", away: "team_foxes", hs: 4, as: 2, status: "final",
    date: "2026-04-19T13:00:00-04:00", field: "Tropical Park 1" },
  { id: "g3", home: "team_foxes", away: "team_sluggers", hs: 5, as: 5, status: "final",
    date: "2026-04-26T13:00:00-04:00", field: "Tropical Park 2" }, // tie
  { id: "g4", home: "team_bears", away: "team_eagles", hs: 7, as: 1, status: "final",
    date: "2026-04-12T16:00:00-04:00", field: "Lake Eola" },
  { id: "g5", home: "team_eagles", away: "team_bears", hs: 2, as: 8, status: "final",
    date: "2026-04-19T16:00:00-04:00", field: "Lake Eola" },
  { id: "g6", home: "team_foxes", away: "team_bears", hs: 3, as: 6, status: "final",
    date: "2026-04-26T16:00:00-04:00", field: "Tropical Park 1" },
  { id: "g7", home: "team_sluggers", away: "team_eagles", hs: 10, as: 0, status: "final",
    date: "2026-05-03T13:00:00-04:00", field: "Tropical Park 1" },
  // Future scheduled games
  { id: "g9", home: "team_eagles", away: "team_foxes", hs: 0, as: 0, status: "scheduled",
    date: "2026-05-10T13:00:00-04:00", field: "Tropical Park 2" },
  { id: "g10", home: "team_bears", away: "team_sluggers", hs: 0, as: 0, status: "scheduled",
    date: "2026-05-10T16:00:00-04:00", field: "Lake Eola" },
  { id: "g11", home: "team_eagles", away: "team_bears", hs: 0, as: 0, status: "scheduled",
    date: "2026-05-17T13:00:00-04:00", field: "Lake Eola" },
  // Should be ignored by standings (and shown as "TBD" on schedule)
  { id: "g8_draft", home: "team_foxes", away: "team_eagles", hs: 99, as: 0, status: "draft",
    date: "2026-05-24T13:00:00-04:00", field: "Tropical Park 2" },
];

// Players. Each carries a team_id (primary team), jersey, position.
// recalcLeague will later attach `stats` and `pitching` subfields to
// these docs. Players who never appear in a box score still show up on
// their team's roster but have no stats line yet.
const PLAYERS = [
  // Tampa Sluggers
  { id: "p1_alice", team_id: "team_sluggers", name: "Alice Carter", jersey: 7, position: "P/SS" },
  { id: "p2_bob",   team_id: "team_sluggers", name: "Bob Diaz",     jersey: 12, position: "C" },
  { id: "p3_carol", team_id: "team_sluggers", name: "Carol Esposito", jersey: 24, position: "OF" },
  // Miami Foxes
  { id: "p4_dan",   team_id: "team_foxes",    name: "Dan Forsyth",  jersey: 3,  position: "P/3B" },
  { id: "p5_emma",  team_id: "team_foxes",    name: "Emma Greene",  jersey: 18, position: "OF" },
  // Orlando Bears (roster only, haven't played in our seeded box scores)
  { id: "p6_frank", team_id: "team_bears",    name: "Frank Hayes",  jersey: 10, position: "1B" },
  { id: "p7_grace", team_id: "team_bears",    name: "Grace Iglesias", jersey: 5,  position: "2B" },
  // Jacksonville Eagles
  { id: "p8_henry", team_id: "team_eagles",   name: "Henry Jameson", jersey: 22, position: "SS" },
  { id: "p9_iris",  team_id: "team_eagles",   name: "Iris Khan",    jersey: 11, position: "OF" },
];

// Box scores for a couple of games. Drives the recalc smoke test.
const BOX_SCORES: Array<[string, Record<string, unknown>]> = [
  [
    "g1",
    {
      status: "final",
      home_team_id: "team_foxes",
      away_team_id: "team_sluggers",
      home_score: 9,
      away_score: 3,
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
      home_team_id: "team_sluggers",
      away_team_id: "team_foxes",
      home_score: 4,
      away_score: 2,
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

  // League config
  await db.doc(`leagues/${LEAGUE_ID}`).set(LEAGUE_CONFIG);

  // Teams
  for (const t of TEAMS) {
    await db.doc(`leagues/${LEAGUE_ID}/teams/${t.id}`).set({
      name: t.name,
      division: t.division,
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
