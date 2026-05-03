// Cross-tenant scoping: a member of league A must not be able to write
// to league B, regardless of role.

import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { makeTestEnv, uid } from "./test-env";

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await makeTestEnv("rules-cross-tenant");
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
});

describe("cross-tenant writes", () => {
  it("admin of sfbl cannot write kcsl team", async () => {
    const ctx = env.authenticatedContext(uid("admin_a"), {
      leagues: { sfbl: "admin" },
    });
    const db = ctx.firestore();
    await assertFails(
      setDoc(doc(db, "leagues/kcsl/teams/team_x"), { name: "Sluggers" }),
    );
  });

  it("admin of sfbl can write sfbl team (sanity)", async () => {
    const ctx = env.authenticatedContext(uid("admin_a"), {
      leagues: { sfbl: "admin" },
    });
    const db = ctx.firestore();
    await assertSucceeds(
      setDoc(doc(db, "leagues/sfbl/teams/team_x"), { name: "Sluggers" }),
    );
  });

  it("captain of sfbl team_a cannot write kcsl box score", async () => {
    await env.withSecurityRulesDisabled(async (admin) => {
      const adb = admin.firestore();
      await setDoc(doc(adb, "leagues/kcsl/games/game1"), {
        home_team_id: "team_a",
        away_team_id: "team_b",
      });
    });

    const ctx = env.authenticatedContext(uid("captain1"), {
      leagues: { sfbl: "captain:team_a" },
    });
    const db = ctx.firestore();
    await assertFails(
      setDoc(doc(db, "leagues/kcsl/box_scores/game1"), { runs: 5 }),
    );
  });

  it("admin of sfbl can read kcsl public collections", async () => {
    // Public-read is intentional — public site reads from any league.
    const ctx = env.authenticatedContext(uid("admin_a"), {
      leagues: { sfbl: "admin" },
    });
    const db = ctx.firestore();
    await assertSucceeds(getDoc(doc(db, "leagues/kcsl/teams/team_x")));
  });

  it("admin of sfbl cannot read kcsl audit log (sensitive)", async () => {
    const ctx = env.authenticatedContext(uid("admin_a"), {
      leagues: { sfbl: "admin" },
    });
    const db = ctx.firestore();
    await assertFails(getDoc(doc(db, "leagues/kcsl/audit/log1")));
  });
});
