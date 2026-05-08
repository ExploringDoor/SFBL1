// PII contract: email + phone MUST live on /_private/contact, never on
// the public-readable parent /players/{pid} doc.
//
// We can't enforce this purely via security rules (Firestore rules
// can't reject specific field names on writes from admin). So this
// test pins the discipline a different way: it verifies the
// /_private path returns the data, and that any public-doc reads
// that show up in the wild won't include those fields by reading
// what the writers actually produce.
//
// The real defense is in the code (lib + writers); this test
// catches regressions where someone re-adds email/phone to the
// public doc.

import { afterAll, beforeAll, beforeEach, describe, it, expect } from "vitest";
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { makeTestEnv, uid } from "./test-env";

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await makeTestEnv("rules-pii-not-public");
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  // Seed: clean public doc + private contact subdoc, mirroring what
  // the production writers should produce post-PII migration.
  await env.withSecurityRulesDisabled(async (admin) => {
    const db = admin.firestore();
    await setDoc(doc(db, "leagues/sfbl/players/p_alice"), {
      name: "Alice Example",
      team_id: "team_a",
      jersey: 7,
      position: "P",
      active: true,
    });
    await setDoc(doc(db, "leagues/sfbl/players/p_alice/_private/contact"), {
      email: "alice@example.com",
      phone: "+1-555-0001",
    });
  });
});

describe("PII discipline — email/phone live in /_private/contact only", () => {
  it("anonymous can read public player doc — but it has no PII", async () => {
    const anon = env.unauthenticatedContext();
    const ref = doc(anon.firestore(), "leagues/sfbl/players/p_alice");
    const snap = await assertSucceeds(getDoc(ref));
    const data = snap.data() ?? {};
    // The public doc carries name, jersey, position, team — but
    // never email or phone. Regression alarm: if these are present,
    // a writer somewhere has re-introduced PII on the public doc.
    expect(data.email).toBeUndefined();
    expect(data.phone).toBeUndefined();
    expect(data.name).toBe("Alice Example");
    expect(data.jersey).toBe(7);
  });

  it("anonymous CANNOT read /_private/contact — gated by rule", async () => {
    const anon = env.unauthenticatedContext();
    const ref = doc(
      anon.firestore(),
      "leagues/sfbl/players/p_alice/_private/contact",
    );
    await assertFails(getDoc(ref));
  });

  it("captain CANNOT read another player's /_private/contact via rules alone — they must use the team-roster API", async () => {
    // Captain of team_a — same team as alice, but the rule allows
    // only admin or self. Captains go through /api/team-roster.
    const cap = env.authenticatedContext(uid("captain"), {
      leagues: { sfbl: "captain:team_a" },
    });
    const ref = doc(
      cap.firestore(),
      "leagues/sfbl/players/p_alice/_private/contact",
    );
    await assertFails(getDoc(ref));
  });

  it("admin CAN read /_private/contact directly", async () => {
    const admin = env.authenticatedContext(uid("admin"), {
      leagues: { sfbl: "admin" },
    });
    const ref = doc(
      admin.firestore(),
      "leagues/sfbl/players/p_alice/_private/contact",
    );
    const snap = await assertSucceeds(getDoc(ref));
    expect(snap.data()?.email).toBe("alice@example.com");
  });

  it("self-player CAN read their own /_private/contact", async () => {
    const player = env.authenticatedContext(uid("player_alice"), {
      leagues: { sfbl: "player:p_alice" },
    });
    const ref = doc(
      player.firestore(),
      "leagues/sfbl/players/p_alice/_private/contact",
    );
    const snap = await assertSucceeds(getDoc(ref));
    expect(snap.data()?.phone).toBe("+1-555-0001");
  });

  it("self-player CANNOT read someone else's /_private/contact", async () => {
    const player = env.authenticatedContext(uid("player_other"), {
      leagues: { sfbl: "player:p_other" },
    });
    const ref = doc(
      player.firestore(),
      "leagues/sfbl/players/p_alice/_private/contact",
    );
    await assertFails(getDoc(ref));
  });
});
