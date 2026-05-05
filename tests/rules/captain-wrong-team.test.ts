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

  // ── box_score_submissions — same authorization model as lineups ──
  it("captain of team_a CAN submit team_a's box score", async () => {
    const ctx = env.authenticatedContext(uid("captain_a"), {
      leagues: { sfbl: "captain:team_a" },
    });
    const db = ctx.firestore();
    await assertSucceeds(
      setDoc(doc(db, "leagues/sfbl/box_score_submissions/game1_team_a"), {
        team_id: "team_a",
        game_id: "game1",
        lineup: [],
        pitchers: [],
      }),
    );
  });

  it("captain of team_a CANNOT submit team_b's box score", async () => {
    const ctx = env.authenticatedContext(uid("captain_a"), {
      leagues: { sfbl: "captain:team_a" },
    });
    const db = ctx.firestore();
    await assertFails(
      setDoc(doc(db, "leagues/sfbl/box_score_submissions/game1_team_b"), {
        team_id: "team_b",
        game_id: "game1",
        lineup: [],
        pitchers: [],
      }),
    );
  });

  it("box_score_submissions doc id must be anchored to team_a suffix", async () => {
    const ctx = env.authenticatedContext(uid("captain_a"), {
      leagues: { sfbl: "captain:team_a" },
    });
    const db = ctx.firestore();
    await assertFails(
      setDoc(
        doc(db, "leagues/sfbl/box_score_submissions/game1_team_a_evil"),
        { team_id: "team_a", game_id: "game1", lineup: [], pitchers: [] },
      ),
    );
  });

  // ── Game-membership check: captain can't write lineup or
  // box_score_submission for a game their team isn't IN, even if the
  // doc id is suffixed with their team id. (Caught by the
  // independent code review on 2026-05-04 — pre-fix, the rule only
  // checked the doc-id suffix and not game membership.) ──────────
  it("captain of team_a CANNOT write lineup for game2 (team_a not in game2)", async () => {
    const ctx = env.authenticatedContext(uid("captain_a"), {
      leagues: { sfbl: "captain:team_a" },
    });
    const db = ctx.firestore();
    await assertFails(
      setDoc(doc(db, "leagues/sfbl/lineups/game2_team_a"), {
        order: ["p1"],
        team_id: "team_a",
        game_id: "game2",
      }),
    );
  });

  it("captain of team_a CANNOT write box_score_submission for game2", async () => {
    const ctx = env.authenticatedContext(uid("captain_a"), {
      leagues: { sfbl: "captain:team_a" },
    });
    const db = ctx.firestore();
    await assertFails(
      setDoc(doc(db, "leagues/sfbl/box_score_submissions/game2_team_a"), {
        team_id: "team_a",
        game_id: "game2",
        score: 99,
      }),
    );
  });

  // ── Score-Only mode goes through the same rules path: captain
  // can write a score-only submission for their own team but NOT
  // for the other team. The `score_only: true` flag is just data
  // shape — rules don't care, only doc id matters. ─────────────
  it("captain of team_a CAN submit a score-only box score for team_a", async () => {
    const ctx = env.authenticatedContext(uid("captain_a"), {
      leagues: { sfbl: "captain:team_a" },
    });
    const db = ctx.firestore();
    await assertSucceeds(
      setDoc(doc(db, "leagues/sfbl/box_score_submissions/game1_team_a"), {
        team_id: "team_a",
        game_id: "game1",
        score_only: true,
        final_score: 7,
        lineup: [],
        pitchers: [],
      }),
    );
  });

  it("captain of team_a CANNOT submit a score-only box score for team_b", async () => {
    const ctx = env.authenticatedContext(uid("captain_a"), {
      leagues: { sfbl: "captain:team_a" },
    });
    const db = ctx.firestore();
    await assertFails(
      setDoc(doc(db, "leagues/sfbl/box_score_submissions/game1_team_b"), {
        team_id: "team_b",
        game_id: "game1",
        score_only: true,
        final_score: 4,
        lineup: [],
        pitchers: [],
      }),
    );
  });

  // 3-lane privacy: captain B should NOT be able to read captain A's
  // score-only submission either. The rules close this for ALL
  // submission shapes, not just full ones.
  it("captain of team_a CANNOT read team_b's score-only submission", async () => {
    // First, seed team_b's submission with rules disabled.
    await env.withSecurityRulesDisabled(async (admin) => {
      await setDoc(
        doc(admin.firestore(), "leagues/sfbl/box_score_submissions/game1_team_b"),
        {
          team_id: "team_b",
          game_id: "game1",
          score_only: true,
          final_score: 4,
        },
      );
    });
    const ctx = env.authenticatedContext(uid("captain_a"), {
      leagues: { sfbl: "captain:team_a" },
    });
    const db = ctx.firestore();
    const { getDoc } = await import("firebase/firestore");
    await assertFails(
      getDoc(doc(db, "leagues/sfbl/box_score_submissions/game1_team_b")),
    );
  });
});
