// Firestore rules tests for /leagues/{leagueId}/captain_chat.
//
// Same posture as /team_messages: auth-only read (no anonymous
// scrapers), no client writes (everything goes through
// /api/chat-message and /api/chat-message-delete).
//
// Captains-only enforcement is server-side via the API endpoints
// (verify caller's claim is captain or admin). Reads are open to any
// authenticated user — admins need to moderate, and the captain-only
// reveal in the prefs UI is client-side gating only.

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
  env = await makeTestEnv("rules-captain-chat");
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
});

describe("/captain_chat — read access", () => {
  it("captain can read a league-wide captain_chat doc", async () => {
    await env.withSecurityRulesDisabled(async (admin) => {
      await setDoc(
        doc(admin.firestore(), "leagues/sfbl/captain_chat/m1"),
        {
          text: "captains huddle",
          author_email: "alice@example.com",
          team_id: "team_a",
        },
      );
    });
    const ctx = env.authenticatedContext(uid("u"), {
      leagues: { sfbl: "captain:team_a" },
    });
    await assertSucceeds(
      getDoc(doc(ctx.firestore(), "leagues/sfbl/captain_chat/m1")),
    );
  });

  it("anonymous user CANNOT read captain_chat", async () => {
    await env.withSecurityRulesDisabled(async (admin) => {
      await setDoc(
        doc(admin.firestore(), "leagues/sfbl/captain_chat/m1"),
        { text: "secret", team_id: "team_a" },
      );
    });
    const ctx = env.unauthenticatedContext();
    await assertFails(
      getDoc(doc(ctx.firestore(), "leagues/sfbl/captain_chat/m1")),
    );
  });
});

describe("/captain_chat — write blocked at rules", () => {
  it("captain CANNOT write captain_chat directly via client SDK", async () => {
    const ctx = env.authenticatedContext(uid("u"), {
      leagues: { sfbl: "captain:team_a" },
    });
    await assertFails(
      setDoc(
        doc(ctx.firestore(), "leagues/sfbl/captain_chat/m_new"),
        { text: "msg", team_id: "team_a" },
      ),
    );
  });

  it("admin CANNOT write captain_chat directly via client SDK", async () => {
    const ctx = env.authenticatedContext(uid("admin"), {
      leagues: { sfbl: "admin" },
    });
    await assertFails(
      setDoc(
        doc(ctx.firestore(), "leagues/sfbl/captain_chat/m_new"),
        { text: "msg" },
      ),
    );
  });

  it("captain of sfbl CANNOT write into kcsl captain_chat", async () => {
    const ctx = env.authenticatedContext(uid("u"), {
      leagues: { sfbl: "captain:team_a" },
    });
    await assertFails(
      setDoc(
        doc(ctx.firestore(), "leagues/kcsl/captain_chat/m_new"),
        { text: "spy msg" },
      ),
    );
  });
});
