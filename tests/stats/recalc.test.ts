// Integration test for recalcLeague(db, leagueId).
//
// Boots Firestore emulator (via `npm test` or `firebase emulators:exec
// --only firestore`), seeds a league + box scores via Admin SDK, runs
// the recalc, and verifies player stats land on /leagues/{id}/players/{pid}.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { recalcLeague } from "@/lib/stats";

const PROJECT_ID =
  process.env.GCLOUD_PROJECT ?? process.env.FIREBASE_PROJECT_ID ?? "demo-recalc-test";

const FIRESTORE_HOST =
  process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE_HOST;

let app: ReturnType<typeof initializeApp> | null = null;
let db: Firestore;

beforeAll(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "recalc-test-app");
  db = getFirestore(app);
});

afterAll(async () => {
  if (app) await deleteApp(app);
});

beforeEach(async () => {
  await fetch(
    `http://${FIRESTORE_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: "DELETE" },
  );
});

async function seedLeague(sport: "softball" | "baseball") {
  await db.doc("leagues/sfbl").set({ slug: "sfbl", sport, name: "Test League" });
}

async function seedBoxScore(gameId: string, body: Record<string, unknown>) {
  await db.doc(`leagues/sfbl/box_scores/${gameId}`).set({
    status: "final",
    ...body,
  });
}

describe("recalcLeague — softball", () => {
  beforeEach(() => seedLeague("softball"));

  it("aggregates batting across two box scores", async () => {
    await seedBoxScore("g1", {
      away_lineup: [
        { player_id: "p1", ab: 4, h: 2, doubles: 1, rbi: 1, bb: 1 },
        { player_id: "p2", ab: 3, h: 1, hr: 1, rbi: 2 },
      ],
      home_lineup: [{ player_id: "p3", ab: 4, h: 0, so: 2 }],
    });
    await seedBoxScore("g2", {
      away_lineup: [{ player_id: "p1", ab: 4, h: 1, hr: 1, rbi: 2 }],
      home_lineup: [{ player_id: "p3", ab: 4, h: 2 }],
    });

    const result = await recalcLeague(db, "sfbl");
    expect(result.box_scores_read).toBe(2);
    expect(result.players_aggregated).toBe(3);
    expect(result.players_written).toBe(3);
    expect(result.pitchers_written).toBe(0);

    const p1 = (await db.doc("leagues/sfbl/players/p1").get()).data()?.stats;
    expect(p1).toMatchObject({ gp: 2, ab: 8, h: 3, hr: 1, doubles: 1 });
    expect(p1.avg).toBeCloseTo(3 / 8, 6);

    const p3 = (await db.doc("leagues/sfbl/players/p3").get()).data()?.stats;
    expect(p3).toMatchObject({ gp: 2, ab: 8, h: 2 });
  });

  it("skips an inconsistent batting line instead of aborting the whole recalc", async () => {
    // One bad line (H < 2B+HR) used to make sluggingPct throw inside
    // aggregateBatting, 500-ing recalc for EVERY player. Now it's
    // skipped + flagged, and the rest of the league still recalcs.
    await seedBoxScore("g1", {
      away_lineup: [
        { player_id: "good", ab: 4, h: 2, doubles: 1 },
        { player_id: "bad", ab: 4, h: 1, doubles: 1, hr: 1 }, // H(1) < 2B+HR(2)
      ],
      home_lineup: [{ player_id: "good2", ab: 3, h: 1 }],
    });

    const result = await recalcLeague(db, "sfbl");

    // Completed without throwing; the offending line is flagged with
    // its exact player + game so the admin can fix that one box score.
    expect(result.flagged_lines).toHaveLength(1);
    expect(result.flagged_lines[0]).toMatchObject({
      player_id: "bad",
      game_id: "g1",
    });

    // Clean players still got their stats written.
    const good = (await db.doc("leagues/sfbl/players/good").get()).data()
      ?.stats;
    expect(good).toMatchObject({ gp: 1, h: 2 });
    const good2 = (await db.doc("leagues/sfbl/players/good2").get()).data()
      ?.stats;
    expect(good2).toMatchObject({ gp: 1, h: 1 });

    // The bad line was dropped entirely — no stats doc rolled up for it.
    const bad = (await db.doc("leagues/sfbl/players/bad").get()).data();
    expect(bad?.stats?.gp ?? 0).toBe(0);
  });

  it("ignores non-final box scores", async () => {
    await seedBoxScore("draft1", {
      status: "draft",
      away_lineup: [{ player_id: "p1", ab: 4, h: 4 }],
      home_lineup: [],
    });
    const result = await recalcLeague(db, "sfbl");
    expect(result.box_scores_read).toBe(0);
    expect(result.players_aggregated).toBe(0);
  });

  it("dirty-check skips writes on second run", async () => {
    await seedBoxScore("g1", {
      away_lineup: [{ player_id: "p1", ab: 4, h: 2 }],
      home_lineup: [],
    });
    const first = await recalcLeague(db, "sfbl");
    expect(first.players_written).toBe(1);

    const second = await recalcLeague(db, "sfbl");
    expect(second.players_aggregated).toBe(1);
    expect(second.players_written).toBe(0); // no-op skipped
  });

  it("rewrites when box score data changes", async () => {
    await seedBoxScore("g1", {
      away_lineup: [{ player_id: "p1", ab: 4, h: 2 }],
      home_lineup: [],
    });
    await recalcLeague(db, "sfbl");

    // Change the box score.
    await seedBoxScore("g1", {
      away_lineup: [{ player_id: "p1", ab: 4, h: 4 }],
      home_lineup: [],
    });
    const result = await recalcLeague(db, "sfbl");
    expect(result.players_written).toBe(1); // rewritten because counts changed

    const p1 = (await db.doc("leagues/sfbl/players/p1").get()).data()?.stats;
    expect(p1.h).toBe(4);
  });

  it("preserves non-stats fields on player doc (merge:true)", async () => {
    // Pre-populate biographical fields.
    await db.doc("leagues/sfbl/players/p1").set({
      name: "Alice Pitcher",
      jersey: 17,
      position: "P",
    });
    await seedBoxScore("g1", {
      away_lineup: [{ player_id: "p1", ab: 4, h: 2 }],
      home_lineup: [],
    });
    await recalcLeague(db, "sfbl");

    const p1 = (await db.doc("leagues/sfbl/players/p1").get()).data();
    expect(p1?.name).toBe("Alice Pitcher");
    expect(p1?.jersey).toBe(17);
    expect(p1?.stats).toMatchObject({ gp: 1, ab: 4, h: 2 });
  });
});

describe("recalcLeague — baseball", () => {
  beforeEach(() => seedLeague("baseball"));

  it("aggregates batting + pitching", async () => {
    await seedBoxScore("g1", {
      away_lineup: [{ player_id: "b1", ab: 4, h: 2, doubles: 1, rbi: 1 }],
      home_lineup: [{ player_id: "b2", ab: 3, h: 1, hr: 1 }],
      away_pitchers: [
        { player_id: "p1", ip_outs: 27, h: 6, r: 2, er: 2, bb: 1, so: 7, hr: 0, decision: "W" },
      ],
      home_pitchers: [
        { player_id: "p2", ip_outs: 27, h: 8, r: 3, er: 3, bb: 2, so: 5, hr: 1, decision: "L" },
      ],
    });
    const result = await recalcLeague(db, "sfbl");
    expect(result.players_written).toBe(2);
    expect(result.pitchers_written).toBe(2);

    const p1 = (await db.doc("leagues/sfbl/players/p1").get()).data();
    expect(p1?.pitching).toMatchObject({
      app: 1, w: 1, l: 0, sv: 0,
      ip_outs: 27, h: 6, er: 2, bb: 1, so: 7,
    });
    expect(p1?.pitching.era).toBeCloseTo(2.0, 6); // (2 * 27) / 27 = 2.00
  });

  it("dirty-check skips BOTH batter AND pitcher writes on second run (regression)", async () => {
    // Earlier the existing-doc map stored only .stats, so .pitching was
    // always undefined and pitchers got rewritten every recalc.
    await seedBoxScore("g1", {
      away_lineup: [{ player_id: "p1", ab: 4, h: 2 }],
      home_lineup: [{ player_id: "p2", ab: 3, h: 1 }],
      away_pitchers: [
        { player_id: "p1", ip_outs: 27, h: 6, r: 2, er: 2, bb: 1, so: 7, hr: 0, decision: "W" },
      ],
      home_pitchers: [
        { player_id: "p2", ip_outs: 27, h: 8, r: 3, er: 3, bb: 2, so: 5, hr: 1, decision: "L" },
      ],
    });

    const first = await recalcLeague(db, "sfbl");
    expect(first.players_written).toBe(2);
    expect(first.pitchers_written).toBe(2);

    const second = await recalcLeague(db, "sfbl");
    expect(second.players_written).toBe(0);
    expect(second.pitchers_written).toBe(0);
  });

  it("rewrites pitcher stats when underlying line changes", async () => {
    await seedBoxScore("g1", {
      away_lineup: [{ player_id: "p1", ab: 1, h: 0 }],
      home_lineup: [],
      away_pitchers: [
        { player_id: "p1", ip_outs: 27, h: 5, r: 1, er: 1, bb: 0, so: 9, hr: 0, decision: "W" },
      ],
      home_pitchers: [],
    });
    await recalcLeague(db, "sfbl");

    // Change ER on the pitching line.
    await seedBoxScore("g1", {
      away_lineup: [{ player_id: "p1", ab: 1, h: 0 }],
      home_lineup: [],
      away_pitchers: [
        { player_id: "p1", ip_outs: 27, h: 5, r: 4, er: 4, bb: 0, so: 9, hr: 0, decision: "W" },
      ],
      home_pitchers: [],
    });
    const result = await recalcLeague(db, "sfbl");
    expect(result.pitchers_written).toBe(1);
  });

  it("does NOT process pitchers for softball league (sport gate)", async () => {
    // Reset to softball mid-test
    await db.doc("leagues/sfbl").set({ sport: "softball" }, { merge: true });
    await seedBoxScore("g1", {
      away_lineup: [{ player_id: "b1", ab: 4, h: 2 }],
      home_lineup: [],
      away_pitchers: [
        { player_id: "p1", ip_outs: 27, h: 6, er: 2, bb: 1, so: 7, hr: 0 },
      ],
      home_pitchers: [],
    });
    const result = await recalcLeague(db, "sfbl");
    expect(result.pitchers_written).toBe(0);
  });
});

describe("recalcLeague — error paths", () => {
  it("throws if league doc doesn't exist", async () => {
    await expect(recalcLeague(db, "ghost-league")).rejects.toThrow(/not found/);
  });

  it("throws on unknown sport", async () => {
    await db.doc("leagues/sfbl").set({ sport: "cricket" });
    await expect(recalcLeague(db, "sfbl")).rejects.toThrow(/unknown sport/);
  });
});
