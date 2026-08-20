// Rosters are not anonymously enumerable.
//
// Audit 2026-08-20: /leagues/{id}/players was `allow read: if true`, so with
// the public web API key anyone could list every player in a league. On
// Island that was 36 minors indexed to their teams, at a moment when the
// office had turned flags.hide_teams on believing the roster was private.
// Doc ids are name slugs, so the path itself carries the child's name.
//
// Nothing on the public website lost anything: /players, /players/{id},
// /teams/{id}, /leaders and the print pages are all server-rendered with the
// Admin SDK, which bypasses these rules entirely.
//
// The bar is signed-in rather than a league role on purpose. The browser
// readers are the captain portal, the admin panel, and /profile's
// availability panel, and a player who links through /api/player-link gets no
// league claim at all, so a role check would lock them out of their own page.

import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  doc,
  getDocs,
  query,
  setDoc,
  where,
} from "firebase/firestore";
import { makeTestEnv, uid } from "./test-env";

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await makeTestEnv("rules-roster-not-enumerable");
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (admin) => {
    const db = admin.firestore();
    // Doc ids are name slugs in production, which is the point.
    await setDoc(doc(db, "leagues/island/players/abigail-example"), {
      name: "Abigail Example",
      team_id: "team_a",
      auth_uid: "parent_uid_1",
    });
    await setDoc(doc(db, "leagues/island/players/brianna-example"), {
      name: "Brianna Example",
      team_id: "team_b",
    });
  });
});

describe("roster enumeration", () => {
  it("anonymous CANNOT list the roster", async () => {
    const anon = env.unauthenticatedContext();
    await assertFails(
      getDocs(collection(anon.firestore(), "leagues/island/players")),
    );
  });

  it("anonymous CANNOT read a single player by guessing the name slug", async () => {
    const anon = env.unauthenticatedContext();
    await assertFails(
      getDocs(
        query(
          collection(anon.firestore(), "leagues/island/players"),
          where("team_id", "==", "team_a"),
        ),
      ),
    );
  });

  it("a captain CAN list the roster (RosterTab, Attendance, box score)", async () => {
    const cap = env.authenticatedContext(uid("captain"), {
      leagues: { island: "captain:team_a" },
    });
    await assertSucceeds(
      getDocs(collection(cap.firestore(), "leagues/island/players")),
    );
  });

  it("an admin CAN list the roster (PaymentsAdmin, SignupsReview)", async () => {
    const admin = env.authenticatedContext(uid("admin"), {
      leagues: { island: "admin" },
    });
    await assertSucceeds(
      getDocs(collection(admin.firestore(), "leagues/island/players")),
    );
  });

  it("a signed-in user with NO league claim CAN still find their own record", async () => {
    // /profile's availability panel. usePlayerLink gives the parent no
    // custom claim, so this is the case a role-based rule would break.
    const parent = env.authenticatedContext(uid("parent"));
    await assertSucceeds(
      getDocs(
        query(
          collection(parent.firestore(), "leagues/island/players"),
          where("auth_uid", "==", "parent_uid_1"),
        ),
      ),
    );
  });

  it("PII stays out of reach even for a signed-in reader", async () => {
    const parent = env.authenticatedContext(uid("parent"));
    await assertFails(
      getDocs(
        collection(
          parent.firestore(),
          "leagues/island/players/abigail-example/_private",
        ),
      ),
    );
  });
});
