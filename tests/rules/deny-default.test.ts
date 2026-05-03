// Default-deny safety net.
//
// firestore.rules ends with a top-level `match /{document=**} { allow
// read, write: if false; }`. This file pins that behavior: any path
// that hasn't been explicitly matched must reject every operation,
// from every auth state, every time.
//
// When you add a new collection, you'll see this test fail. That's the
// reminder to either (a) add a `match` block AND a regression test in
// a sibling file, or (b) document why the path is intentionally
// covered by default-deny.

import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  assertFails,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { makeTestEnv, uid } from "./test-env";

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await makeTestEnv("rules-deny-default");
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
});

// Paths that should hit the top-level deny-everything fallthrough.
// Add to this list whenever you want to confirm a not-yet-implemented
// collection is locked. Any of these accidentally becoming readable or
// writable means rules drift.
const UNDECLARED_PATHS = [
  // Top-level collections that don't exist in the schema:
  "platform_audit/log1",
  "pending_tenants/abc",
  "anything_made_up/x",
  // Subcollections of /leagues/{id} that aren't declared:
  "leagues/sfbl/notifications/n1",
  "leagues/sfbl/secret_collection/foo",
  // Sibling of /users that's not /users/{uid}:
  "user_settings/x",
] as const;

// Auth states to exhaustively try against each path.
function makeAuthStates(env: RulesTestEnvironment) {
  return [
    {
      label: "anonymous",
      ctx: env.unauthenticatedContext(),
    },
    {
      label: "authenticated, no claims",
      ctx: env.authenticatedContext(uid("noclaim"), {}),
    },
    {
      label: "captain of sfbl team_a",
      ctx: env.authenticatedContext(uid("captain"), {
        leagues: { sfbl: "captain:team_a" },
      }),
    },
    {
      label: "admin of sfbl",
      ctx: env.authenticatedContext(uid("admin"), {
        leagues: { sfbl: "admin" },
      }),
    },
    {
      label: "admin of every league",
      ctx: env.authenticatedContext(uid("multi"), {
        leagues: { sfbl: "admin", kcsl: "admin", dvsl: "admin" },
      }),
    },
  ] as const;
}

describe("undeclared paths are deny-by-default", () => {
  for (const path of UNDECLARED_PATHS) {
    describe(`path: ${path}`, () => {
      it("rejects reads from every auth state", async () => {
        for (const { label, ctx } of makeAuthStates(env)) {
          const db = ctx.firestore();
          await assertFails(getDoc(doc(db, path))).catch((e) => {
            throw new Error(`${label} unexpectedly succeeded reading ${path}: ${e}`);
          });
        }
      });

      it("rejects writes from every auth state", async () => {
        for (const { label, ctx } of makeAuthStates(env)) {
          const db = ctx.firestore();
          await assertFails(setDoc(doc(db, path), { x: 1 })).catch((e) => {
            throw new Error(`${label} unexpectedly succeeded writing ${path}: ${e}`);
          });
        }
      });
    });
  }
});
