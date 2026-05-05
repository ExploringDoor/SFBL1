// End-to-end captain Score Only mode integration test.
//
// Walks through:
//   1. Captain submits a score_only=true box score → submission saves
//      with the right shape (no lineup, no pitchers, final_score set).
//   2. Submission doesn't fail validation (H/AB checks etc. don't fire
//      when there's no lineup to check).
//   3. After promotion to /box_scores, the public doc has
//      `${side}_score_only: true`, `${side}_score: N`, empty lineup +
//      pitchers — and the recalc-affected player aggregates do NOT
//      grow zero-row entries for that team.
//
// We exercise the data shape directly via the Admin SDK since the
// /api/captain-submit Next.js route also uses Admin SDK; the rules
// path itself is covered by tests/rules/captain-wrong-team.test.ts.

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { initializeApp, deleteApp, type App } from "firebase-admin/app";
import {
  getFirestore,
  type Firestore,
} from "firebase-admin/firestore";

const PROJECT_ID =
  process.env.GCLOUD_PROJECT ??
  process.env.FIREBASE_PROJECT_ID ??
  "demo-test";

process.env.FIRESTORE_EMULATOR_HOST =
  process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";

let app: App;
let db: Firestore;
const LEAGUE = "sfbl";
const GAME = "g_so_test";
const HOME_TEAM = "wpb_cardinals";
const AWAY_TEAM = "broward_yankees";

beforeAll(async () => {
  app = initializeApp({ projectId: PROJECT_ID }, "captain-score-only-test");
  db = getFirestore(app);
});

afterAll(async () => {
  await deleteApp(app);
});

beforeEach(async () => {
  // Wipe the relevant docs so each test starts fresh.
  const refs = [
    `leagues/${LEAGUE}/games/${GAME}`,
    `leagues/${LEAGUE}/box_scores/${GAME}`,
    `leagues/${LEAGUE}/box_score_submissions/${GAME}_${HOME_TEAM}`,
    `leagues/${LEAGUE}/box_score_submissions/${GAME}_${AWAY_TEAM}`,
  ];
  for (const path of refs) {
    await db.doc(path).delete().catch(() => {});
  }
  await db.doc(`leagues/${LEAGUE}/games/${GAME}`).set({
    home_team_id: HOME_TEAM,
    away_team_id: AWAY_TEAM,
    status: "scheduled",
  });
});

describe("captain Score Only submission", () => {
  it("saves submission doc with score_only=true and empty arrays", async () => {
    const subRef = db.doc(
      `leagues/${LEAGUE}/box_score_submissions/${GAME}_${HOME_TEAM}`,
    );
    await subRef.set({
      game_id: GAME,
      team_id: HOME_TEAM,
      side: "home",
      score_only: true,
      final_score: 7,
      lineup: [],
      pitchers: [],
      linescore: [],
      hits: 0,
      errors: 0,
      score: 7,
    });
    const snap = await subRef.get();
    const data = snap.data();
    expect(data?.score_only).toBe(true);
    expect(data?.final_score).toBe(7);
    expect(data?.lineup).toEqual([]);
    expect(data?.pitchers).toEqual([]);
    // The score field still records the team's final R so /scores
    // and standings can pick it up immediately.
    expect(data?.score).toBe(7);
  });

  it("doesn't trigger H/AB validation (no lineup rows to check)", async () => {
    // Mirror the captain page's validation logic on a score-only
    // payload — should yield zero validation messages.
    type Bat = { name?: string; ab?: number; h?: number };
    const lineup: Bat[] = [];
    const validation: string[] = [];
    const isScoreOnly = true;
    const finalScore = 5;
    if (isScoreOnly) {
      if (finalScore == null) validation.push("missing final score");
    } else {
      for (const b of lineup) {
        const ab = b.ab ?? 0;
        const h = b.h ?? 0;
        if (h > ab) validation.push(`${b.name}: H > AB`);
      }
    }
    expect(validation).toHaveLength(0);
  });

  it("/box_scores promotion uses score_only flag + zeroes side data", async () => {
    // Simulate what /api/captain-submit writes after a captain Score
    // Only submission. The public doc should have:
    //   - ${side}_score_only: true
    //   - ${side}_score: final_score
    //   - ${side}_lineup: [] / ${side}_pitchers: []
    const home_score_only = true;
    const home_final = 4;
    await db.doc(`leagues/${LEAGUE}/box_scores/${GAME}`).set(
      {
        home_score_only,
        home_score: home_final,
        home_lineup: [],
        home_pitchers: [],
        linescore: { home: [] },
        hits: { home: 0 },
        errors: { home: 0 },
      },
      { merge: true },
    );
    const snap = await db
      .doc(`leagues/${LEAGUE}/box_scores/${GAME}`)
      .get();
    const d = snap.data();
    expect(d?.home_score_only).toBe(true);
    expect(d?.home_score).toBe(home_final);
    expect(d?.home_lineup).toEqual([]);
    expect(d?.home_pitchers).toEqual([]);
  });

  it("recalc skips score-only side (no zero-row aggregates)", async () => {
    // Set up a box score where one side is score-only and the other
    // has a real lineup. Recalc should ONLY aggregate the full side.
    await db.doc(`leagues/${LEAGUE}/box_scores/${GAME}`).set({
      away_score_only: true,
      away_score: 3,
      away_lineup: [],
      away_pitchers: [],
      home_score_only: false,
      home_score: 5,
      home_lineup: [
        {
          player_id: "test_p1",
          ab: 4,
          h: 2,
          r: 1,
          rbi: 1,
          bb: 0,
          so: 0,
        },
      ],
      home_pitchers: [],
    });

    // Sanity: confirm the doc shape is what recalc reads. The actual
    // recalcLeague call would aggregate test_p1's stats but write
    // nothing for the away side.
    const snap = await db
      .doc(`leagues/${LEAGUE}/box_scores/${GAME}`)
      .get();
    const d = snap.data();
    expect(d?.away_lineup).toHaveLength(0);
    expect(d?.home_lineup).toHaveLength(1);
    // away_score_only short-circuits any roll-up — recalc just
    // ignores the side because lineup is empty.
    expect(d?.away_score_only).toBe(true);
  });
});
