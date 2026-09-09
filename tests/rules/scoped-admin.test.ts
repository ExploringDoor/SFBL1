// Scoped admin roles, at the rules layer.
//
// A league can hand out extra passwords that open PART of the admin
// (lib/admin-roles.ts). /api/public-admin-claim mints "admin:<roleId>" for
// those, and the rules widen exactly two READS for them and nothing else.
//
// What these tests pin, in order of how badly it would hurt to get wrong:
//   1. the only thing any scoped role can write is the umpires collection,
//      and only the umpires role can write it
//   2. a scoped role cannot read the OTHER role's collection
//   3. the full admin is completely unaffected
//   4. anonymous is still refused, which the earlier honeypot work established
//      matters here: the umpire roster carries officials' phones and the dates
//      they cannot work.
//   5. a CONFIG-DEFINED role (ETBL's town commissioners, admin:<town> with the
//      scopes expanded into admin_scopes at mint time) gets exactly the reads
//      its scopes name and no writes at all — the town binding is enforced by
//      the score API, so at this layer it must look like nobody for writes.

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
// A town commissioner. Not in the code's role table; the league doc declared
// it and /api/public-admin-claim expanded its scopes. admin_town is for the
// score API only — the rules never read it.
const TOWN = {
  leagues: { etbl: "admin:mineola" },
  admin_role: "mineola",
  admin_scopes: ["scores", "volunteers"],
  admin_town: "Mineola",
};

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
    await setDoc(doc(db, "leagues/etbl/games/g1"), {
      away_team_id: "t1",
      home_team_id: "t2",
      status: "scheduled",
    });
    await setDoc(doc(db, "leagues/etbl/box_score_submissions/g1_t1"), {
      away_score: 30,
      home_score: 22,
    });
    await setDoc(doc(db, "leagues/etbl/umpires/u1"), { name: "Ref Example" });
    await setDoc(doc(db, "leagues/etbl/audit/a1"), { kind: "score_quick_batch" });
  });
});

describe("town commissioner role (config-defined, ETBL)", () => {
  it("CAN read submitted box scores, which the Scores tab loads", async () => {
    const c = env.authenticatedContext(uid("mineola"), TOWN);
    await assertSucceeds(
      getDoc(doc(c.firestore(), "leagues/etbl/box_score_submissions/g1_t1")),
    );
  });

  it("CANNOT write a game score directly — only the API, which checks the town, may", async () => {
    const db = env.authenticatedContext(uid("mineola"), TOWN).firestore();
    await assertFails(setDoc(doc(db, "leagues/etbl/games/g1"), { home_score: 40 }));
    await assertFails(setDoc(doc(db, "leagues/etbl/teams/t1"), { organization: "Quitman" }));
  });

  it("CANNOT read the umpire roster or the audit log", async () => {
    const db = env.authenticatedContext(uid("mineola"), TOWN).firestore();
    await assertFails(getDoc(doc(db, "leagues/etbl/umpires/u1")));
    await assertFails(getDoc(doc(db, "leagues/etbl/audit/a1")));
  });

  it("CANNOT read another tenant's submissions", async () => {
    const c = env.authenticatedContext(uid("mineola-x"), TOWN);
    await assertFails(
      getDoc(doc(c.firestore(), "leagues/island/box_score_submissions/g1_team_a")),
    );
  });
});

describe("umpires role", () => {
  it("CAN read the umpire roster", async () => {
    const c = env.authenticatedContext(uid("ump"), UMPIRE);
    await assertSucceeds(getDoc(doc(c.firestore(), "leagues/island/umpires/u1")));
  });

  it("CAN write an umpire, since 2026-09-01", async () => {
    const c = env.authenticatedContext(uid("ump"), UMPIRE);
    await assertSucceeds(
      setDoc(doc(c.firestore(), "leagues/island/umpires/u1"), { name: "changed" }),
    );
  });

  it("still CANNOT write anything outside its own collection", async () => {
    const db = env.authenticatedContext(uid("ump"), UMPIRE).firestore();
    await assertFails(setDoc(doc(db, "leagues/island/teams/t1"), { name: "x" }));
    await assertFails(setDoc(doc(db, "leagues/island/games/g1"), { home_score: 9 }));
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

  it("CANNOT write the umpire roster either", async () => {
    const c = env.authenticatedContext(uid("sched"), SCHEDULER);
    await assertFails(
      setDoc(doc(c.firestore(), "leagues/island/umpires/u1"), { name: "x" }),
    );
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
