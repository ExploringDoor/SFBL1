// Firestore rules tests for /leagues/{leagueId}/captain_chat.
//
// Same posture as /team_messages: auth-only read (no anonymous
// scrapers), no client writes (everything goes through
// /api/chat-message and /api/chat-message-delete).
//
// 2026-08 audit HIGH-01: read was `request.auth != null`, so any
// authenticated user — including a captain of another league — could
// read this league's captains chat. Reads are now scoped to admins and
// captains OF THIS LEAGUE (still open enough for cross-team moderation,
// but closed to players, non-members, and other tenants).

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

describe("/captain_chat — read access (captains + admins, tenant-scoped)", () => {
  async function seedMsg() {
    await env.withSecurityRulesDisabled(async (admin) => {
      await setDoc(doc(admin.firestore(), "leagues/sfbl/captain_chat/m1"), {
        text: "captains huddle",
        author_email: "alice@example.com",
        team_id: "team_a",
      });
    });
  }

  it("a captain in the league can read", async () => {
    await seedMsg();
    const ctx = env.authenticatedContext(uid("cap"), {
      leagues: { sfbl: "captain:team_a" },
    });
    await assertSucceeds(
      getDoc(doc(ctx.firestore(), "leagues/sfbl/captain_chat/m1")),
    );
  });

  it("an admin can read (for moderation)", async () => {
    await seedMsg();
    const ctx = env.authenticatedContext(uid("adm"), {
      leagues: { sfbl: "admin" },
    });
    await assertSucceeds(
      getDoc(doc(ctx.firestore(), "leagues/sfbl/captain_chat/m1")),
    );
  });

  it("a plain player (non-captain) CANNOT read captain_chat", async () => {
    await seedMsg();
    const ctx = env.authenticatedContext(uid("plr"), {
      leagues: { sfbl: "player:p1" },
    });
    await assertFails(
      getDoc(doc(ctx.firestore(), "leagues/sfbl/captain_chat/m1")),
    );
  });

  it("a captain of ANOTHER league CANNOT read this league's captain_chat (cross-tenant)", async () => {
    await seedMsg();
    const ctx = env.authenticatedContext(uid("spy"), {
      leagues: { kcsl: "captain:team_a" },
    });
    await assertFails(
      getDoc(doc(ctx.firestore(), "leagues/sfbl/captain_chat/m1")),
    );
  });

  it("anonymous user CANNOT read captain_chat", async () => {
    await seedMsg();
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
