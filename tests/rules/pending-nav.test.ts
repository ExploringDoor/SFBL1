// Firestore rules tests for /pending_nav.
//
// Read posture mirrors /notification_tokens: only the doc owner
// (auth_uid match) can read. Writes are blocked at the rules layer
// — every mutation goes through /api/send-notification (writes) or
// /api/dismiss-pending-nav (updates) so we can audit + scope.

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
  env = await makeTestEnv("rules-pending-nav");
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
});

describe("/pending_nav — read access", () => {
  it("user can read their own pending_nav doc", async () => {
    const ownerUid = uid("owner");
    await env.withSecurityRulesDisabled(async (admin) => {
      await setDoc(doc(admin.firestore(), "pending_nav/n1"), {
        token: "tok",
        auth_uid: ownerUid,
        leagueId: "sfbl",
        title: "msg",
        body: "hi",
        url: "/",
        category: "scores",
        ts: new Date().toISOString(),
        dismissed_at: null,
      });
    });
    const ctx = env.authenticatedContext(ownerUid, {
      leagues: { sfbl: "captain:team_a" },
    });
    await assertSucceeds(
      getDoc(doc(ctx.firestore(), "pending_nav/n1")),
    );
  });

  it("user CANNOT read another user's pending_nav doc", async () => {
    const ownerUid = uid("owner");
    const snooperUid = uid("snooper");
    await env.withSecurityRulesDisabled(async (admin) => {
      await setDoc(doc(admin.firestore(), "pending_nav/n1"), {
        token: "tok",
        auth_uid: ownerUid,
        leagueId: "sfbl",
      });
    });
    const ctx = env.authenticatedContext(snooperUid, {
      leagues: { sfbl: "captain:team_a" },
    });
    await assertFails(getDoc(doc(ctx.firestore(), "pending_nav/n1")));
  });

  it("admin CANNOT read another user's pending_nav doc via client SDK", async () => {
    // Server endpoints (Admin SDK) bypass rules — that's intentional.
    // But the client-SDK path stays scoped to the doc owner.
    const ownerUid = uid("player");
    const adminUid = uid("admin");
    await env.withSecurityRulesDisabled(async (admin) => {
      await setDoc(doc(admin.firestore(), "pending_nav/n1"), {
        token: "tok",
        auth_uid: ownerUid,
        leagueId: "sfbl",
      });
    });
    const ctx = env.authenticatedContext(adminUid, {
      leagues: { sfbl: "admin" },
    });
    await assertFails(getDoc(doc(ctx.firestore(), "pending_nav/n1")));
  });
});

describe("/pending_nav — write blocked at rules", () => {
  it("user CANNOT write a pending_nav doc directly", async () => {
    const ownerUid = uid("owner");
    const ctx = env.authenticatedContext(ownerUid, {
      leagues: { sfbl: "captain:team_a" },
    });
    await assertFails(
      setDoc(doc(ctx.firestore(), "pending_nav/n_new"), {
        auth_uid: ownerUid,
        leagueId: "sfbl",
      }),
    );
  });

  it("user CANNOT mark another user's doc as dismissed via client SDK", async () => {
    const ownerUid = uid("owner");
    const attackerUid = uid("attacker");
    await env.withSecurityRulesDisabled(async (admin) => {
      await setDoc(doc(admin.firestore(), "pending_nav/n1"), {
        auth_uid: ownerUid,
        leagueId: "sfbl",
        dismissed_at: null,
      });
    });
    const ctx = env.authenticatedContext(attackerUid, {
      leagues: { sfbl: "captain:team_a" },
    });
    await assertFails(
      setDoc(
        doc(ctx.firestore(), "pending_nav/n1"),
        { dismissed_at: new Date().toISOString() },
        { merge: true },
      ),
    );
  });
});
