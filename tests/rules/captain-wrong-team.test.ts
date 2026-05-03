// Captain-of-wrong-team: a captain may only write box scores for games
// where their team is one of the two participants.

import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, setDoc } from "firebase/firestore";
import { makeTestEnv, uid } from "./test-env";

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await makeTestEnv("rules-captain-wrong-team");
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    // Game 1: team_a vs team_b
    await setDoc(doc(db, "leagues/sfbl/games/game1"), {
      home_team_id: "team_a",
      away_team_id: "team_b",
    });
    // Game 2: team_c vs team_d (captain of team_a is NOT in this game)
    await setDoc(doc(db, "leagues/sfbl/games/game2"), {
      home_team_id: "team_c",
      away_team_id: "team_d",
    });
  });
});

describe("captain box score writes", () => {
  it("captain of team_a CAN write box score for game1 (team_a is home)", async () => {
    const ctx = env.authenticatedContext(uid("captain_a"), {
      leagues: { sfbl: "captain:team_a" },
    });
    const db = ctx.firestore();
    await assertSucceeds(
      setDoc(doc(db, "leagues/sfbl/box_scores/game1"), {
        runs: { team_a: 5, team_b: 3 },
      }),
    );
  });

  it("captain of team_b CAN write box score for game1 (team_b is away)", async () => {
    const ctx = env.authenticatedContext(uid("captain_b"), {
      leagues: { sfbl: "captain:team_b" },
    });
    const db = ctx.firestore();
    await assertSucceeds(
      setDoc(doc(db, "leagues/sfbl/box_scores/game1"), {
        runs: { team_a: 5, team_b: 3 },
      }),
    );
  });

  it("captain of team_a CANNOT write box score for game2 (team_a not in it)", async () => {
    const ctx = env.authenticatedContext(uid("captain_a"), {
      leagues: { sfbl: "captain:team_a" },
    });
    const db = ctx.firestore();
    await assertFails(
      setDoc(doc(db, "leagues/sfbl/box_scores/game2"), {
        runs: { team_c: 7, team_d: 2 },
      }),
    );
  });

  it("captain of team_a CANNOT set team_b's lineup", async () => {
    const ctx = env.authenticatedContext(uid("captain_a"), {
      leagues: { sfbl: "captain:team_a" },
    });
    const db = ctx.firestore();
    await assertFails(
      setDoc(doc(db, "leagues/sfbl/lineups/game1_team_b"), {
        order: ["p1", "p2"],
      }),
    );
  });

  it("captain of team_a CAN set team_a's lineup", async () => {
    const ctx = env.authenticatedContext(uid("captain_a"), {
      leagues: { sfbl: "captain:team_a" },
    });
    const db = ctx.firestore();
    await assertSucceeds(
      setDoc(doc(db, "leagues/sfbl/lineups/game1_team_a"), {
        order: ["p1", "p2"],
      }),
    );
  });

  // Regression: lineup regex must be anchored. Without `^...$`, a captain of
  // team_a could write `lineups/anything_team_a_evil` because `_team_a` is
  // a substring. Confirm the anchored rule rejects it.
  it("captain of team_a CANNOT write lineup with extra suffix", async () => {
    const ctx = env.authenticatedContext(uid("captain_a"), {
      leagues: { sfbl: "captain:team_a" },
    });
    const db = ctx.firestore();
    await assertFails(
      setDoc(doc(db, "leagues/sfbl/lineups/game1_team_a_evil"), {
        order: ["p1"],
      }),
    );
  });

  it("captain of team_a CANNOT write lineup that only contains team_a as substring", async () => {
    const ctx = env.authenticatedContext(uid("captain_a"), {
      leagues: { sfbl: "captain:team_a" },
    });
    const db = ctx.firestore();
    await assertFails(
      setDoc(doc(db, "leagues/sfbl/lineups/team_alpha"), { order: ["p1"] }),
    );
  });
});
