// Admin-only paths: league config doc and admin-only collections must
// reject writes from non-admin members and reject reads of sensitive
// collections from anyone but admins.

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
  env = await makeTestEnv("rules-admin-only-paths");
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
});

describe("league config doc", () => {
  it("admin CAN write league config", async () => {
    const ctx = env.authenticatedContext(uid("admin"), {
      leagues: { sfbl: "admin" },
    });
    const db = ctx.firestore();
    await assertSucceeds(
      setDoc(doc(db, "leagues/sfbl"), {
        name: "South Florida Baseball",
        sport: "baseball",
      }),
    );
  });

  it("captain CANNOT write league config", async () => {
    const ctx = env.authenticatedContext(uid("captain"), {
      leagues: { sfbl: "captain:team_a" },
    });
    const db = ctx.firestore();
    await assertFails(
      setDoc(doc(db, "leagues/sfbl"), { name: "rogue rename" }),
    );
  });

  it("anonymous CAN read league config (public site)", async () => {
    const ctx = env.unauthenticatedContext();
    const db = ctx.firestore();
    await assertSucceeds(getDoc(doc(db, "leagues/sfbl")));
  });
});

describe("audit log", () => {
  it("admin CAN read audit log", async () => {
    const ctx = env.authenticatedContext(uid("admin"), {
      leagues: { sfbl: "admin" },
    });
    const db = ctx.firestore();
    await assertSucceeds(getDoc(doc(db, "leagues/sfbl/audit/log1")));
  });

  it("captain CANNOT read audit log", async () => {
    const ctx = env.authenticatedContext(uid("captain"), {
      leagues: { sfbl: "captain:team_a" },
    });
    const db = ctx.firestore();
    await assertFails(getDoc(doc(db, "leagues/sfbl/audit/log1")));
  });

  it("anonymous CANNOT read audit log", async () => {
    const ctx = env.unauthenticatedContext();
    const db = ctx.firestore();
    await assertFails(getDoc(doc(db, "leagues/sfbl/audit/log1")));
  });

  it("nobody can write audit log via client SDK (server-only)", async () => {
    const ctx = env.authenticatedContext(uid("admin"), {
      leagues: { sfbl: "admin" },
    });
    const db = ctx.firestore();
    await assertFails(
      setDoc(doc(db, "leagues/sfbl/audit/log1"), { event: "x" }),
    );
  });
});

describe("/domains mapping", () => {
  it("anyone can read (middleware needs it pre-auth)", async () => {
    const ctx = env.unauthenticatedContext();
    const db = ctx.firestore();
    await assertSucceeds(getDoc(doc(db, "domains/sfbl.com")));
  });

  it("admin CANNOT write domain mapping via client SDK (server-only)", async () => {
    const ctx = env.authenticatedContext(uid("admin"), {
      leagues: { sfbl: "admin" },
    });
    const db = ctx.firestore();
    await assertFails(
      setDoc(doc(db, "domains/sfbl.com"), { leagueId: "sfbl" }),
    );
  });
});

describe("/errors", () => {
  // Anonymous create-from-anywhere used to be allowed; an attacker could
  // fill the collection. Now restricted to authenticated callers, with a
  // Cloud Function ingest planned for Phase 2c.
  it("anonymous CANNOT create error log entry", async () => {
    const ctx = env.unauthenticatedContext();
    const db = ctx.firestore();
    await assertFails(
      setDoc(doc(db, "errors/abc"), { msg: "spam", at: "now" }),
    );
  });

  it("authenticated user CAN create error log entry", async () => {
    const ctx = env.authenticatedContext(uid("user"), {});
    const db = ctx.firestore();
    await assertSucceeds(
      setDoc(doc(db, "errors/abc2"), { msg: "real error", at: "now" }),
    );
  });

  it("nobody can read /errors via client SDK", async () => {
    const ctx = env.authenticatedContext(uid("admin"), {
      leagues: { sfbl: "admin" },
    });
    const db = ctx.firestore();
    await assertFails(getDoc(doc(db, "errors/abc")));
  });
});

describe("/users", () => {
  it("user can read/write own profile", async () => {
    const ownerUid = uid("user");
    const ctx = env.authenticatedContext(ownerUid, {});
    const db = ctx.firestore();
    await assertSucceeds(
      setDoc(doc(db, `users/${ownerUid}`), { email: "x@y.com" }),
    );
    await assertSucceeds(getDoc(doc(db, `users/${ownerUid}`)));
  });

  it("user CANNOT read another user's profile", async () => {
    const ctx = env.authenticatedContext(uid("user_a"), {});
    const db = ctx.firestore();
    await assertFails(getDoc(doc(db, "users/some_other_user")));
  });
});
