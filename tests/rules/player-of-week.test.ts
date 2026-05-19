// Player of the Week — public-content collection at
// /leagues/{id}/player_of_week. Public-read (the page + admin list
// read it client-side), admin-only client write. Mutations actually
// go through /api/admin-player-of-week (Admin SDK, bypasses rules),
// but the client-write rule mirrors photos / page_content /
// site_config and must hold. Audit (CLAUDE.md): a rules test
// accompanies every rules change.

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
  env = await makeTestEnv("rules-player-of-week");
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
});

const PATH = "leagues/sfbl/player_of_week/entry1";

describe("/player_of_week reads", () => {
  it("anonymous CAN read (public page + admin list)", async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertSucceeds(getDoc(doc(db, PATH)));
  });

  it("admin of the league CAN read", async () => {
    const db = env
      .authenticatedContext(uid("admin"), { leagues: { sfbl: "admin" } })
      .firestore();
    await assertSucceeds(getDoc(doc(db, PATH)));
  });
});

describe("/player_of_week writes", () => {
  it("admin of the league CAN write", async () => {
    const db = env
      .authenticatedContext(uid("admin"), { leagues: { sfbl: "admin" } })
      .firestore();
    await assertSucceeds(
      setDoc(doc(db, PATH), {
        player_name: "Carlos Mendez",
        team_name: "Miami Yankees",
      }),
    );
  });

  it("anonymous CANNOT write", async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(
      setDoc(doc(db, PATH), { player_name: "rogue" }),
    );
  });

  it("captain CANNOT write", async () => {
    const db = env
      .authenticatedContext(uid("captain"), {
        leagues: { sfbl: "captain:team_a" },
      })
      .firestore();
    await assertFails(
      setDoc(doc(db, PATH), { player_name: "rogue" }),
    );
  });

  it("admin of a DIFFERENT league CANNOT write (cross-tenant)", async () => {
    const db = env
      .authenticatedContext(uid("other_admin"), {
        leagues: { lbdc: "admin" },
      })
      .firestore();
    await assertFails(
      setDoc(doc(db, PATH), { player_name: "cross-tenant" }),
    );
  });
});
