// Scoped admin roles, at the rules layer.
//
// A league can hand out extra passwords that open PART of the admin
// (lib/admin-roles.ts). /api/public-admin-claim mints "admin:<roleId>" for
// those, and the rules widen exactly two READS for them and nothing else.
//
// What these tests pin, in order of how badly it would hurt to get wrong:
//   1. a scoped role can never WRITE anything, however narrow its scope
//   2. a scoped role cannot read the OTHER role's collection
//   3. the full admin is completely unaffected
//   4. anonymous is still refused, which the earlier honeypot work established
//      matters here: the umpire roster carries officials' phones and the dates
//      they cannot work.

import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { makeTestEnv, uid } from "./test-env";

let env: RulesTestEnvironment;

// Claims shaped exactly as /api/public-admin-claim mints them: the league
// claim names the role, admin_scopes carries what it opens.
const UMPIRE = {
  leagues: { island: "admin:umpires" },
  admin_scopes: ["umpires"],
};
const SCHEDULER = {
  leagues: { island: "admin:scheduler" },
  admin_scopes: ["scores", "schedule", "schedule-gen", "score-disputes", "broadcast"],
};
const OWNER = { leagues: { island: "admin" } };

beforeAll(async () => {
  env = await makeTestEnv("rules-scoped-admin");
});
afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (admin) => {
    const db = admin.firestore();
    await setDoc(doc(db, "leagues/island/umpires/u1"), {
      name: "Pat Example",
      phone: "631-555-0100",
      unavailable: ["2026-09-12"],
    });
    await setDoc(doc(db, "leagues/island/box_score_submissions/g1_team_a"), {
      away_score: 4,
      home_score: 3,
    });
  });
});

describe("umpires role", () => {
  it("CAN read the umpire roster", async () => {
    const c = env.authenticatedContext(uid("ump"), UMPIRE);
    await assertSucceeds(getDoc(doc(c.firestore(), "leagues/island/umpires/u1")));
  });

  it("CANNOT write an umpire", async () => {
    const c = env.authenticatedContext(uid("ump"), UMPIRE);
    await assertFails(
      setDoc(doc(c.firestore(), "leagues/island/umpires/u1"), { name: "changed" }),
    );
  });

  it("CANNOT read the other role's collection", async () => {
    const c = env.authenticatedContext(uid("ump"), UMPIRE);
    await assertFails(
      getDoc(doc(c.firestore(), "leagues/island/box_score_submissions/g1_team_a")),
    );
  });
});

describe("scheduler role", () => {
  it("CAN read submitted box scores", async () => {
    const c = env.authenticatedContext(uid("sched"), SCHEDULER);
    await assertSucceeds(
      getDoc(doc(c.firestore(), "leagues/island/box_score_submissions/g1_team_a")),
    );
  });

  it("CANNOT read the umpire roster, which carries officials' phone numbers", async () => {
    const c = env.authenticatedContext(uid("sched"), SCHEDULER);
    await assertFails(getDoc(doc(c.firestore(), "leagues/island/umpires/u1")));
  });

  it("CANNOT write a box score submission", async () => {
    const c = env.authenticatedContext(uid("sched"), SCHEDULER);
    await assertFails(
      setDoc(doc(c.firestore(), "leagues/island/box_score_submissions/g1_team_a"), {
        away_score: 99,
      }),
    );
  });
});

describe("the owner is unaffected", () => {
  it("full admin still reads both", async () => {
    // One firestore() handle, reused. Calling it twice on the same context
    // re-initialises the client and throws "settings can no longer be changed".
    const db = env.authenticatedContext(uid("owner"), OWNER).firestore();
    await assertSucceeds(getDoc(doc(db, "leagues/island/umpires/u1")));
    await assertSucceeds(
      getDoc(doc(db, "leagues/island/box_score_submissions/g1_team_a")),
    );
  });

  it("full admin still writes an umpire", async () => {
    const c = env.authenticatedContext(uid("owner"), OWNER);
    await assertSucceeds(
      setDoc(doc(c.firestore(), "leagues/island/umpires/u1"), { name: "Pat E." }),
    );
  });
});

describe("nothing else got in", () => {
  it("anonymous still cannot read the umpire roster", async () => {
    const anon = env.unauthenticatedContext();
    await assertFails(getDoc(doc(anon.firestore(), "leagues/island/umpires/u1")));
  });

  it("an unknown role id grants nothing", async () => {
    const c = env.authenticatedContext(uid("bogus"), {
      leagues: { island: "admin:not-a-real-role" },
      admin_scopes: [],
    });
    await assertFails(getDoc(doc(c.firestore(), "leagues/island/umpires/u1")));
  });

  it("a scoped claim for ANOTHER league grants nothing here", async () => {
    const c = env.authenticatedContext(uid("crosstenant"), {
      leagues: { coybl: "admin:umpires" },
      admin_scopes: ["umpires"],
    });
    await assertFails(getDoc(doc(c.firestore(), "leagues/island/umpires/u1")));
  });
});
