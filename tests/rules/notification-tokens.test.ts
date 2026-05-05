// Firestore rules tests for /notification_tokens.
//
// Layer-3 of cross-tenant push isolation: even if the send endpoint
// had a bug, the client SDK must not be able to enumerate or read
// other users' tokens. Combined with the integration matcher test,
// a SFBL captain has zero paths to receive a KCSL push.

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
  env = await makeTestEnv("rules-notification-tokens");
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
});

describe("/notification_tokens — read access", () => {
  it("user can read their own token doc", async () => {
    const ownerUid = uid("captain_sfbl");
    await env.withSecurityRulesDisabled(async (admin) => {
      await setDoc(
        doc(admin.firestore(), "notification_tokens/tok_abc_sfbl"),
        {
          token: "tok_abc",
          leagueId: "sfbl",
          auth_uid: ownerUid,
          categories: ["scores"],
        },
      );
    });
    const ctx = env.authenticatedContext(ownerUid, {
      leagues: { sfbl: "captain:team_a" },
    });
    await assertSucceeds(
      getDoc(doc(ctx.firestore(), "notification_tokens/tok_abc_sfbl")),
    );
  });

  it("user CANNOT read another user's token doc", async () => {
    const ownerUid = uid("captain_sfbl");
    const snooperUid = uid("captain_kcsl");
    await env.withSecurityRulesDisabled(async (admin) => {
      await setDoc(
        doc(admin.firestore(), "notification_tokens/tok_abc_sfbl"),
        {
          token: "tok_abc",
          leagueId: "sfbl",
          auth_uid: ownerUid,
          categories: ["scores"],
        },
      );
    });
    const ctx = env.authenticatedContext(snooperUid, {
      leagues: { kcsl: "captain:team_b" },
    });
    await assertFails(
      getDoc(doc(ctx.firestore(), "notification_tokens/tok_abc_sfbl")),
    );
  });

  it("admin of sfbl CANNOT read another user's token doc via client SDK", async () => {
    // Even an admin must use the server endpoint (Admin SDK) to enumerate
    // tokens — the client-side path is blocked. Prevents an admin-claimed
    // user from script-tagging a list of tokens out of the browser.
    const ownerUid = uid("player");
    const adminUid = uid("admin_sfbl");
    await env.withSecurityRulesDisabled(async (admin) => {
      await setDoc(
        doc(admin.firestore(), "notification_tokens/tok_xyz_sfbl"),
        {
          token: "tok_xyz",
          leagueId: "sfbl",
          auth_uid: ownerUid,
        },
      );
    });
    const ctx = env.authenticatedContext(adminUid, {
      leagues: { sfbl: "admin" },
    });
    await assertFails(
      getDoc(doc(ctx.firestore(), "notification_tokens/tok_xyz_sfbl")),
    );
  });
});

describe("/notification_tokens — write access", () => {
  it("user CANNOT write their own token doc directly (must go through API)", async () => {
    const ownerUid = uid("captain");
    const ctx = env.authenticatedContext(ownerUid, {
      leagues: { sfbl: "captain:team_a" },
    });
    await assertFails(
      setDoc(
        doc(ctx.firestore(), "notification_tokens/tok_new_sfbl"),
        {
          token: "tok_new",
          leagueId: "sfbl",
          auth_uid: ownerUid,
        },
      ),
    );
  });

  it("user CANNOT update another user's token doc to point at themselves", async () => {
    // Hijack attempt: rewrite victim's auth_uid to attacker's, so
    // future reads succeed. Must fail at write time.
    const victimUid = uid("victim");
    const attackerUid = uid("attacker");
    await env.withSecurityRulesDisabled(async (admin) => {
      await setDoc(
        doc(admin.firestore(), "notification_tokens/tok_v_sfbl"),
        {
          token: "tok_v",
          leagueId: "sfbl",
          auth_uid: victimUid,
        },
      );
    });
    const ctx = env.authenticatedContext(attackerUid, {
      leagues: { sfbl: "captain:team_a" },
    });
    await assertFails(
      setDoc(
        doc(ctx.firestore(), "notification_tokens/tok_v_sfbl"),
        { auth_uid: attackerUid },
        { merge: true },
      ),
    );
  });
});
