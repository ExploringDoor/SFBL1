// `_private/{doc}` subcollection convention.
//
// PII (phone, email, DOB, internal notes) lives at:
//   /leagues/{id}/players/{pid}/_private/contact   → admin OR self-player
//   /leagues/{id}/teams/{tid}/_private/contact     → admin OR captain-of-team
//   /leagues/{id}/games/{gid}/_private/notes       → admin only
//
// These tests pin the pattern. CSV imports and admin UIs MUST split
// fields so PII never lands on parent docs.

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
  env = await makeTestEnv("rules-private-subcollection");
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (admin) => {
    const db = admin.firestore();
    // Seed _private docs so reads have something to fetch.
    await setDoc(doc(db, "leagues/sfbl/players/p1/_private/contact"), {
      email: "p1@example.com",
      phone: "+1-555-0001",
    });
    await setDoc(doc(db, "leagues/sfbl/players/p2/_private/contact"), {
      email: "p2@example.com",
    });
    await setDoc(doc(db, "leagues/sfbl/teams/team_a/_private/contact"), {
      captain_phone: "+1-555-1000",
    });
    await setDoc(doc(db, "leagues/sfbl/teams/team_b/_private/contact"), {
      captain_phone: "+1-555-1001",
    });
    await setDoc(doc(db, "leagues/sfbl/games/game1/_private/notes"), {
      umpire_contact: "ump@example.com",
    });
  });
});

describe("/leagues/{id}/players/{pid}/_private", () => {
  it("anonymous CANNOT read", async () => {
    const ctx = env.unauthenticatedContext();
    const db = ctx.firestore();
    await assertFails(getDoc(doc(db, "leagues/sfbl/players/p1/_private/contact")));
  });

  it("captain of sfbl CANNOT read player _private (only admin or self)", async () => {
    const ctx = env.authenticatedContext(uid("cap"), {
      leagues: { sfbl: "captain:team_a" },
    });
    const db = ctx.firestore();
    await assertFails(getDoc(doc(db, "leagues/sfbl/players/p1/_private/contact")));
  });

  it("admin of OTHER league CANNOT read sfbl player _private", async () => {
    const ctx = env.authenticatedContext(uid("admin_other"), {
      leagues: { kcsl: "admin" },
    });
    const db = ctx.firestore();
    await assertFails(getDoc(doc(db, "leagues/sfbl/players/p1/_private/contact")));
  });

  it("admin of sfbl CAN read player _private", async () => {
    const ctx = env.authenticatedContext(uid("admin"), {
      leagues: { sfbl: "admin" },
    });
    const db = ctx.firestore();
    await assertSucceeds(getDoc(doc(db, "leagues/sfbl/players/p1/_private/contact")));
  });

  it("player p1 CAN read OWN _private", async () => {
    const ctx = env.authenticatedContext(uid("p1"), {
      leagues: { sfbl: "player:p1" },
    });
    const db = ctx.firestore();
    await assertSucceeds(getDoc(doc(db, "leagues/sfbl/players/p1/_private/contact")));
  });

  it("player p1 CANNOT read p2's _private", async () => {
    const ctx = env.authenticatedContext(uid("p1"), {
      leagues: { sfbl: "player:p1" },
    });
    const db = ctx.firestore();
    await assertFails(getDoc(doc(db, "leagues/sfbl/players/p2/_private/contact")));
  });

  it("player p1 CAN write own _private", async () => {
    const ctx = env.authenticatedContext(uid("p1"), {
      leagues: { sfbl: "player:p1" },
    });
    const db = ctx.firestore();
    await assertSucceeds(
      setDoc(doc(db, "leagues/sfbl/players/p1/_private/contact"), {
        email: "new@example.com",
      }),
    );
  });

  it("player p1 CANNOT write p2's _private", async () => {
    const ctx = env.authenticatedContext(uid("p1"), {
      leagues: { sfbl: "player:p1" },
    });
    const db = ctx.firestore();
    await assertFails(
      setDoc(doc(db, "leagues/sfbl/players/p2/_private/contact"), {
        email: "evil@example.com",
      }),
    );
  });
});

describe("/leagues/{id}/teams/{tid}/_private", () => {
  it("anonymous CANNOT read team _private", async () => {
    const ctx = env.unauthenticatedContext();
    const db = ctx.firestore();
    await assertFails(getDoc(doc(db, "leagues/sfbl/teams/team_a/_private/contact")));
  });

  it("random user (no claim) CANNOT read", async () => {
    const ctx = env.authenticatedContext(uid("rand"), {});
    const db = ctx.firestore();
    await assertFails(getDoc(doc(db, "leagues/sfbl/teams/team_a/_private/contact")));
  });

  it("captain of team_a CAN read team_a _private", async () => {
    const ctx = env.authenticatedContext(uid("cap_a"), {
      leagues: { sfbl: "captain:team_a" },
    });
    const db = ctx.firestore();
    await assertSucceeds(getDoc(doc(db, "leagues/sfbl/teams/team_a/_private/contact")));
  });

  it("captain of team_a CANNOT read team_b _private", async () => {
    const ctx = env.authenticatedContext(uid("cap_a"), {
      leagues: { sfbl: "captain:team_a" },
    });
    const db = ctx.firestore();
    await assertFails(getDoc(doc(db, "leagues/sfbl/teams/team_b/_private/contact")));
  });

  it("admin of OTHER league CANNOT read", async () => {
    const ctx = env.authenticatedContext(uid("admin_other"), {
      leagues: { kcsl: "admin" },
    });
    const db = ctx.firestore();
    await assertFails(getDoc(doc(db, "leagues/sfbl/teams/team_a/_private/contact")));
  });

  it("captain of team_a CAN write team_a _private", async () => {
    const ctx = env.authenticatedContext(uid("cap_a"), {
      leagues: { sfbl: "captain:team_a" },
    });
    const db = ctx.firestore();
    await assertSucceeds(
      setDoc(doc(db, "leagues/sfbl/teams/team_a/_private/contact"), {
        captain_phone: "+1-555-9999",
      }),
    );
  });

  it("captain of team_a CANNOT write team_b _private", async () => {
    const ctx = env.authenticatedContext(uid("cap_a"), {
      leagues: { sfbl: "captain:team_a" },
    });
    const db = ctx.firestore();
    await assertFails(
      setDoc(doc(db, "leagues/sfbl/teams/team_b/_private/contact"), {
        captain_phone: "+1-555-EVIL",
      }),
    );
  });
});

describe("/leagues/{id}/games/{gid}/_private", () => {
  it("anonymous CANNOT read game _private", async () => {
    const ctx = env.unauthenticatedContext();
    const db = ctx.firestore();
    await assertFails(getDoc(doc(db, "leagues/sfbl/games/game1/_private/notes")));
  });

  it("captain CANNOT read game _private (admin only)", async () => {
    const ctx = env.authenticatedContext(uid("cap"), {
      leagues: { sfbl: "captain:team_a" },
    });
    const db = ctx.firestore();
    await assertFails(getDoc(doc(db, "leagues/sfbl/games/game1/_private/notes")));
  });

  it("admin of sfbl CAN read game _private", async () => {
    const ctx = env.authenticatedContext(uid("admin"), {
      leagues: { sfbl: "admin" },
    });
    const db = ctx.firestore();
    await assertSucceeds(getDoc(doc(db, "leagues/sfbl/games/game1/_private/notes")));
  });

  it("admin of OTHER league CANNOT read", async () => {
    const ctx = env.authenticatedContext(uid("admin_other"), {
      leagues: { kcsl: "admin" },
    });
    const db = ctx.firestore();
    await assertFails(getDoc(doc(db, "leagues/sfbl/games/game1/_private/notes")));
  });

  it("admin of sfbl CAN write game _private", async () => {
    const ctx = env.authenticatedContext(uid("admin"), {
      leagues: { sfbl: "admin" },
    });
    const db = ctx.firestore();
    await assertSucceeds(
      setDoc(doc(db, "leagues/sfbl/games/game1/_private/notes"), {
        umpire_contact: "new@example.com",
      }),
    );
  });

  it("captain CANNOT write game _private", async () => {
    const ctx = env.authenticatedContext(uid("cap"), {
      leagues: { sfbl: "captain:team_a" },
    });
    const db = ctx.firestore();
    await assertFails(
      setDoc(doc(db, "leagues/sfbl/games/game1/_private/notes"), {
        umpire_contact: "evil@example.com",
      }),
    );
  });
});
