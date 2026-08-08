// M3 (2026-08 audit): the public /players/{id} doc must never carry PII.
// The write rule now rejects any create/update that includes
// dob / date_of_birth / email / phone keys, so an admin mistake or a bad
// CSV import can't land a birthdate or contact detail on a world-readable
// document. PII belongs in /players/{id}/_private/contact (covered by
// private-subcollection.test.ts).
//
// Note: legitimate player creation runs through Admin-SDK routes, which
// bypass rules — this guard is the client-SDK backstop.

import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, setDoc } from "firebase/firestore";
import { makeTestEnv, uid } from "./test-env";

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await makeTestEnv("rules-players-public-pii");
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
});

function adminDb() {
  return env
    .authenticatedContext(uid("adm"), { leagues: { sfbl: "admin" } })
    .firestore();
}

describe("/players/{id} public doc — PII keys rejected", () => {
  it("admin CAN write a clean public player doc", async () => {
    await assertSucceeds(
      setDoc(doc(adminDb(), "leagues/sfbl/players/p1"), {
        name: "Alex Kim",
        jersey: 7,
        position: "SS",
        team_id: "team_a",
      }),
    );
  });

  it("admin CANNOT put dob on the public player doc", async () => {
    await assertFails(
      setDoc(doc(adminDb(), "leagues/sfbl/players/p2"), {
        name: "Alex Kim",
        dob: "1990-05-01",
      }),
    );
  });

  it("admin CANNOT put date_of_birth on the public player doc", async () => {
    await assertFails(
      setDoc(doc(adminDb(), "leagues/sfbl/players/p3"), {
        name: "Alex Kim",
        date_of_birth: "1990-05-01",
      }),
    );
  });

  it("admin CANNOT put email on the public player doc", async () => {
    await assertFails(
      setDoc(doc(adminDb(), "leagues/sfbl/players/p4"), {
        name: "Alex Kim",
        email: "alex@example.com",
      }),
    );
  });

  it("admin CANNOT put phone on the public player doc", async () => {
    await assertFails(
      setDoc(doc(adminDb(), "leagues/sfbl/players/p5"), {
        name: "Alex Kim",
        phone: "+1-555-0000",
      }),
    );
  });
});
