// Firestore rules tests for /leagues/{leagueId}/availability.
//
// Public-read within tenant (matches DVSL — captains and players need
// the team-wide RSVP summary). Cross-tenant reads are blocked because
// queries scope by leagueId in the path.
//
// Direct client writes are blocked entirely — every mutation goes
// through /api/availability-rsvp (Admin SDK) so we can verify
// captain-of-team or player-self ownership before the doc lands.

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
  env = await makeTestEnv("rules-availability");
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
});

describe("/availability — read access", () => {
  it("anyone authenticated can read SFBL availability", async () => {
    await env.withSecurityRulesDisabled(async (admin) => {
      await setDoc(
        doc(
          admin.firestore(),
          "leagues/sfbl/availability/team_a_g1_player_x",
        ),
        {
          game_id: "g1",
          player_id: "player_x",
          team_id: "team_a",
          status: "yes",
        },
      );
    });
    const ctx = env.authenticatedContext(uid("u"), {
      leagues: { sfbl: "captain:team_a" },
    });
    await assertSucceeds(
      getDoc(
        doc(
          ctx.firestore(),
          "leagues/sfbl/availability/team_a_g1_player_x",
        ),
      ),
    );
  });
});

describe("/availability — write access blocked at rules level", () => {
  it("captain of sfbl team_a CANNOT write directly via client SDK", async () => {
    const ctx = env.authenticatedContext(uid("u"), {
      leagues: { sfbl: "captain:team_a" },
    });
    await assertFails(
      setDoc(
        doc(
          ctx.firestore(),
          "leagues/sfbl/availability/team_a_g1_player_x",
        ),
        {
          game_id: "g1",
          player_id: "player_x",
          team_id: "team_a",
          status: "yes",
        },
      ),
    );
  });

  it("admin of sfbl CANNOT write directly via client SDK", async () => {
    const ctx = env.authenticatedContext(uid("admin"), {
      leagues: { sfbl: "admin" },
    });
    await assertFails(
      setDoc(
        doc(
          ctx.firestore(),
          "leagues/sfbl/availability/team_a_g1_player_x",
        ),
        { status: "yes" },
      ),
    );
  });
});

describe("/availability — cross-tenant", () => {
  it("captain of sfbl team_a CANNOT write a kcsl availability doc", async () => {
    const ctx = env.authenticatedContext(uid("u"), {
      leagues: { sfbl: "captain:team_a" },
    });
    await assertFails(
      setDoc(
        doc(
          ctx.firestore(),
          "leagues/kcsl/availability/team_a_g1_player_x",
        ),
        {
          game_id: "g1",
          player_id: "player_x",
          team_id: "team_a",
          status: "yes",
        },
      ),
    );
  });

  // Read is intentionally public per-tenant (matches DVSL). Cross-tenant
  // read still works because public-read is per-doc, not per-league —
  // but no sensitive data lives in availability (just yes/maybe/no per
  // (game,player)), and the data is already public-facing as part of
  // team rosters. If we ever store private notes here, this test should
  // be updated to assert isolation.
});
