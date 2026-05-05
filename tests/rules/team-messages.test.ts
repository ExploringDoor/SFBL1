// Firestore rules tests for /leagues/{leagueId}/team_messages.
//
// Read: authenticated only (no anonymous scrapers). Within tenant,
// any authenticated user can read — this is the same posture DVSL
// has, plus a small tightening (anonymous → blocked).
//
// Write: blocked entirely from client SDK. /api/chat-message,
// /api/chat-message-delete, /api/chat-reset all use the Admin SDK
// and bypass rules. Verifying the write block here ensures no future
// rule loosening accidentally lets a client-SDK write through.

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
  env = await makeTestEnv("rules-team-messages");
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
});

describe("/team_messages — read access", () => {
  it("authenticated user can read a team_messages doc", async () => {
    await env.withSecurityRulesDisabled(async (admin) => {
      await setDoc(
        doc(admin.firestore(), "leagues/sfbl/team_messages/m1"),
        {
          text: "hi",
          author_email: "alice@example.com",
          team_id: "team_a",
        },
      );
    });
    const ctx = env.authenticatedContext(uid("u"), {
      leagues: { sfbl: "captain:team_a" },
    });
    await assertSucceeds(
      getDoc(doc(ctx.firestore(), "leagues/sfbl/team_messages/m1")),
    );
  });

  it("anonymous user CANNOT read team_messages", async () => {
    await env.withSecurityRulesDisabled(async (admin) => {
      await setDoc(
        doc(admin.firestore(), "leagues/sfbl/team_messages/m1"),
        { text: "hi", team_id: "team_a" },
      );
    });
    const ctx = env.unauthenticatedContext();
    await assertFails(
      getDoc(doc(ctx.firestore(), "leagues/sfbl/team_messages/m1")),
    );
  });
});

describe("/team_messages — write blocked at rules", () => {
  it("captain CANNOT write team_messages directly", async () => {
    const ctx = env.authenticatedContext(uid("u"), {
      leagues: { sfbl: "captain:team_a" },
    });
    await assertFails(
      setDoc(
        doc(ctx.firestore(), "leagues/sfbl/team_messages/m_new"),
        {
          text: "hi",
          team_id: "team_a",
          author_email: "captain@example.com",
        },
      ),
    );
  });

  it("admin CANNOT write team_messages directly", async () => {
    const ctx = env.authenticatedContext(uid("admin"), {
      leagues: { sfbl: "admin" },
    });
    await assertFails(
      setDoc(
        doc(ctx.firestore(), "leagues/sfbl/team_messages/m_new"),
        { text: "hi", team_id: "team_a" },
      ),
    );
  });

  it("captain of sfbl CANNOT write into kcsl team_messages", async () => {
    const ctx = env.authenticatedContext(uid("u"), {
      leagues: { sfbl: "captain:team_a" },
    });
    await assertFails(
      setDoc(
        doc(ctx.firestore(), "leagues/kcsl/team_messages/m_new"),
        { text: "hi", team_id: "team_a" },
      ),
    );
  });
});
