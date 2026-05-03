// Missing/expired claim: writes from users with no league claim are denied.
// (True JWT expiry is server-side; rules see whatever the token currently
// contains, so we test the absent-claim case.)

import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  assertFails,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, setDoc } from "firebase/firestore";
import { makeTestEnv, uid } from "./test-env";

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await makeTestEnv("rules-missing-claim");
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (admin) => {
    await setDoc(doc(admin.firestore(), "leagues/sfbl/games/game1"), {
      home_team_id: "team_a",
      away_team_id: "team_b",
    });
  });
});

describe("missing or stale claim", () => {
  it("unauthenticated user cannot write a team", async () => {
    const ctx = env.unauthenticatedContext();
    const db = ctx.firestore();
    await assertFails(setDoc(doc(db, "leagues/sfbl/teams/team_x"), { name: "x" }));
  });

  it("authenticated user with NO leagues claim cannot write", async () => {
    const ctx = env.authenticatedContext(uid("randouser"), {});
    const db = ctx.firestore();
    await assertFails(setDoc(doc(db, "leagues/sfbl/teams/team_x"), { name: "x" }));
  });

  it("authenticated user with claim for OTHER league cannot write here", async () => {
    const ctx = env.authenticatedContext(uid("user_b"), {
      leagues: { kcsl: "admin" },
    });
    const db = ctx.firestore();
    await assertFails(setDoc(doc(db, "leagues/sfbl/teams/team_x"), { name: "x" }));
  });

  it("authenticated user with empty leagues map cannot write", async () => {
    const ctx = env.authenticatedContext(uid("user_c"), { leagues: {} });
    const db = ctx.firestore();
    await assertFails(setDoc(doc(db, "leagues/sfbl/teams/team_x"), { name: "x" }));
  });

  it("captain claim for nonexistent game is rejected on box score write", async () => {
    // No game `ghost` exists, so isCaptainOfGameTeam's get() fails → write denied.
    const ctx = env.authenticatedContext(uid("captain_a"), {
      leagues: { sfbl: "captain:team_a" },
    });
    const db = ctx.firestore();
    await assertFails(setDoc(doc(db, "leagues/sfbl/box_scores/ghost"), { runs: 1 }));
  });

  // Regression: captain claim regex is anchored to `^captain:[^:]+$`. A
  // malformed claim like "captain:foo:bar" used to parse as captain of
  // team "foo" — now rejected outright.
  it('malformed claim "captain:foo:bar" is rejected', async () => {
    const ctx = env.authenticatedContext(uid("malformed1"), {
      leagues: { sfbl: "captain:team_a:stale" },
    });
    const db = ctx.firestore();
    await assertFails(
      setDoc(doc(db, "leagues/sfbl/box_scores/game1"), { runs: 1 }),
    );
  });

  it('malformed claim "captain:" with empty team is rejected', async () => {
    const ctx = env.authenticatedContext(uid("malformed2"), {
      leagues: { sfbl: "captain:" },
    });
    const db = ctx.firestore();
    await assertFails(
      setDoc(doc(db, "leagues/sfbl/box_scores/game1"), { runs: 1 }),
    );
  });
});
