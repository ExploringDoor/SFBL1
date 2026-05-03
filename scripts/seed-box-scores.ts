// Seeds a couple of box scores into a running emulator so the
// /admin recalc button has data to chew on. Idempotent: re-run to
// reset to the same state.
//
// Usage (with `npm run dev:emulators` already running in another terminal):
//   FIRESTORE_EMULATOR_HOST=localhost:8080 \
//   GCLOUD_PROJECT=league-platform-5f3c8 \
//   npx tsx scripts/seed-box-scores.ts
//
// Or just: npm run seed:box-scores

import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const projectId =
  process.env.GCLOUD_PROJECT ??
  process.env.FIREBASE_PROJECT_ID ??
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ??
  "league-platform-5f3c8";

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error(
    "[seed-box-scores] FIRESTORE_EMULATOR_HOST not set. " +
      "This script targets the EMULATOR — set it explicitly to avoid " +
      "writing to production by accident.",
  );
  process.exit(1);
}

initializeApp({ projectId });
const db = getFirestore();

async function run() {
  console.log(
    `[seed-box-scores] Writing to ${process.env.FIRESTORE_EMULATOR_HOST} (project: ${projectId})`,
  );

  // Game 1: a baseball blowout — Sluggers @ Foxes.
  await db.doc("leagues/sfbl/box_scores/g1").set({
    status: "final",
    home_team_id: "team_foxes",
    away_team_id: "team_sluggers",
    home_score: 9,
    away_score: 3,
    away_lineup: [
      { player_id: "p1_alice", ab: 4, h: 3, doubles: 1, hr: 1, rbi: 3, bb: 0, so: 1, r: 2 },
      { player_id: "p2_bob",   ab: 4, h: 1, doubles: 0, hr: 0, rbi: 0, bb: 0, so: 2, r: 0 },
      { player_id: "p3_carol", ab: 3, h: 0, doubles: 0, hr: 0, rbi: 0, bb: 1, so: 1, r: 1 },
    ],
    home_lineup: [
      { player_id: "p4_dan",   ab: 5, h: 2, doubles: 1, hr: 0, rbi: 1, bb: 0, so: 0, r: 1 },
      { player_id: "p5_emma",  ab: 4, h: 2, doubles: 0, hr: 1, rbi: 4, bb: 1, so: 1, r: 2 },
    ],
    away_pitchers: [
      {
        player_id: "p1_alice", // pitcher who also bats
        ip_outs: 18, // 6.0 IP
        h: 7, r: 5, er: 5, bb: 2, so: 4, hr: 1,
        decision: "L",
      },
    ],
    home_pitchers: [
      {
        player_id: "p4_dan",
        ip_outs: 27, // 9.0 IP — complete game
        h: 4, r: 3, er: 2, bb: 1, so: 9, hr: 0,
        decision: "W",
      },
    ],
  });

  // Game 2: low-scoring rematch.
  await db.doc("leagues/sfbl/box_scores/g2").set({
    status: "final",
    home_team_id: "team_sluggers",
    away_team_id: "team_foxes",
    home_score: 4,
    away_score: 2,
    away_lineup: [
      { player_id: "p4_dan",   ab: 4, h: 1, doubles: 0, hr: 0, rbi: 1, bb: 0, so: 1, r: 0 },
      { player_id: "p5_emma",  ab: 3, h: 0, doubles: 0, hr: 0, rbi: 0, bb: 1, so: 0, r: 0 },
    ],
    home_lineup: [
      { player_id: "p1_alice", ab: 4, h: 2, doubles: 0, hr: 0, rbi: 1, bb: 0, so: 0, r: 1 },
      { player_id: "p2_bob",   ab: 3, h: 1, doubles: 1, hr: 0, rbi: 1, bb: 1, so: 0, r: 1 },
    ],
    away_pitchers: [
      {
        player_id: "p4_dan",
        ip_outs: 24, // 8.0 IP
        h: 6, r: 4, er: 3, bb: 2, so: 5, hr: 0,
        decision: "L",
      },
    ],
    home_pitchers: [
      {
        player_id: "p1_alice",
        ip_outs: 27, // 9.0 IP
        h: 4, r: 2, er: 1, bb: 0, so: 11, hr: 0,
        decision: "W",
      },
    ],
  });

  // Draft game — should be IGNORED by recalc.
  await db.doc("leagues/sfbl/box_scores/g3_draft").set({
    status: "draft",
    home_team_id: "team_sluggers",
    away_team_id: "team_foxes",
    home_score: 99,
    away_score: 0,
    away_lineup: [
      { player_id: "p1_alice", ab: 5, h: 5, hr: 5, rbi: 25 },
    ],
    home_lineup: [],
  });

  console.log("[seed-box-scores] Done. Three box scores written (g1, g2 final; g3 draft).");
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[seed-box-scores] Failed:", err);
    process.exit(1);
  });
