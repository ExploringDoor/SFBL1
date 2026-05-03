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
};

const TEAMS = [
  { id: "team_foxes", name: "Miami Foxes", division: "East" },
  { id: "team_sluggers", name: "Tampa Sluggers", division: "East" },
  { id: "team_bears", name: "Orlando Bears", division: "West" },
  { id: "team_eagles", name: "Jacksonville Eagles", division: "West" },
];

// Games: a small round-robin so standings show interesting variance.
// Status varies so we exercise the "ignore drafts" rule too.
const GAMES = [
  // East division
  { id: "g1", home: "team_foxes", away: "team_sluggers", hs: 9, as: 3, status: "final" },
  { id: "g2", home: "team_sluggers", away: "team_foxes", hs: 4, as: 2, status: "final" },
  { id: "g3", home: "team_foxes", away: "team_sluggers", hs: 5, as: 5, status: "final" }, // tie
  // West division
  { id: "g4", home: "team_bears", away: "team_eagles", hs: 7, as: 1, status: "final" },
  { id: "g5", home: "team_eagles", away: "team_bears", hs: 2, as: 8, status: "final" },
  // Cross-division
  { id: "g6", home: "team_foxes", away: "team_bears", hs: 3, as: 6, status: "final" },
  { id: "g7", home: "team_sluggers", away: "team_eagles", hs: 10, as: 0, status: "final" },
  // Should be ignored by standings
  { id: "g8_draft", home: "team_foxes", away: "team_eagles", hs: 99, as: 0, status: "draft" },
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
    });
  }

  // Box scores
  for (const [id, body] of BOX_SCORES) {
    await db.doc(`leagues/${LEAGUE_ID}/box_scores/${id}`).set(body);
  }

  console.log(
    `[seed-fixture] done — ${TEAMS.length} teams, ${GAMES.length} games (1 draft), ${BOX_SCORES.length} box scores`,
  );
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[seed-fixture] failed:", err);
    process.exit(1);
  });
