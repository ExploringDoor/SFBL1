// Firestore rules tests for two lock-downs from the 2026-08 security audit:
//
//   1. /leagues/{id}/_secrets/{doc} — Admin-SDK-ONLY (allow read, write: if false).
//      Holds the admin sign-in password, which previously sat on the
//      world-readable /leagues/{id} config doc. That was the CRITICAL:
//      any unauthenticated visitor could getDoc() the league doc and read
//      the password in cleartext, then mint an admin token. The password
//      now lives here, reachable only by the Admin SDK (which bypasses
//      rules) inside /api/public-admin-claim.
//
//   2. /errors — no client-SDK create (allow create: if false). Error rows
//      are written only via /api/errors-log (Admin SDK). Previously any
//      authenticated user could create arbitrary error docs and spam the
//      collection.

import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  assertFails,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { makeTestEnv, uid } from "./test-env";

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await makeTestEnv("rules-errors-secrets");
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (admin) => {
    await setDoc(doc(admin.firestore(), "leagues/sfbl/_secrets/admin"), {
      password: "s3cr3t-do-not-leak",
    });
  });
});

describe("/leagues/{id}/_secrets — Admin-SDK only", () => {
  it("anonymous CANNOT read the admin password secret", async () => {
    const ctx = env.unauthenticatedContext();
    await assertFails(
      getDoc(doc(ctx.firestore(), "leagues/sfbl/_secrets/admin")),
    );
  });

  it("a league admin CANNOT read the secret via client SDK", async () => {
    const ctx = env.authenticatedContext(uid("adm"), {
      leagues: { sfbl: "admin" },
    });
    await assertFails(
      getDoc(doc(ctx.firestore(), "leagues/sfbl/_secrets/admin")),
    );
  });

  it("a captain CANNOT read the secret", async () => {
    const ctx = env.authenticatedContext(uid("cap"), {
      leagues: { sfbl: "captain:team_a" },
    });
    await assertFails(
      getDoc(doc(ctx.firestore(), "leagues/sfbl/_secrets/admin")),
    );
  });

  it("nobody can write the secret via client SDK (even admin)", async () => {
    const ctx = env.authenticatedContext(uid("adm2"), {
      leagues: { sfbl: "admin" },
    });
    await assertFails(
      setDoc(doc(ctx.firestore(), "leagues/sfbl/_secrets/admin"), {
        password: "attacker-set",
      }),
    );
  });
});

describe("/errors — no client create, no client read", () => {
  it("an authenticated user CANNOT create an error doc", async () => {
    const ctx = env.authenticatedContext(uid("u"), {
      leagues: { sfbl: "captain:team_a" },
    });
    await assertFails(
      setDoc(doc(ctx.firestore(), "errors/e1"), { message: "spam", at: 1 }),
    );
  });

  it("an anonymous user CANNOT create an error doc", async () => {
    const ctx = env.unauthenticatedContext();
    await assertFails(
      setDoc(doc(ctx.firestore(), "errors/e2"), { message: "spam" }),
    );
  });

  it("nobody can read the errors collection via client SDK", async () => {
    await env.withSecurityRulesDisabled(async (admin) => {
      await setDoc(doc(admin.firestore(), "errors/seed"), { message: "boom" });
    });
    const ctx = env.authenticatedContext(uid("adm"), {
      leagues: { sfbl: "admin" },
    });
    await assertFails(getDoc(doc(ctx.firestore(), "errors/seed")));
  });
});
