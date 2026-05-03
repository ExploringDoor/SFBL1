// End-to-end auth + claims integration test.
//
// Boots the Auth and Firestore emulators, creates a Firebase Auth user
// via the Admin SDK, sets `leagues.sfbl = 'admin'` on that user, then
// uses the client SDK to sign in and verifies:
//   1. With the admin claim → CAN write to /leagues/sfbl/teams/X
//   2. Without the claim    → CANNOT write to /leagues/sfbl/teams/X
//
// This proves the full chain: token issuance → custom claim → security
// rule check → write succeeds (or fails).

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { initializeApp as initAdmin, deleteApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import {
  initializeApp as initClient,
  deleteApp as deleteClientApp,
} from "firebase/app";
import {
  connectAuthEmulator,
  getAuth as getClientAuth,
  signInWithCustomToken,
  signOut,
} from "firebase/auth";
import {
  connectFirestoreEmulator,
  doc,
  getFirestore,
  setDoc,
} from "firebase/firestore";

// Read the active emulator project ID from env (set by `firebase
// emulators:exec --project ...`). Falls back to a stable name for manual
// runs. With `singleProjectMode: true` in firebase.json, the project ID
// in the test apps MUST match the emulator's, or auth tokens won't
// validate against Firestore — that's a real foot-gun if it drifts.
const PROJECT_ID =
  process.env.GCLOUD_PROJECT ?? process.env.FIREBASE_PROJECT_ID ?? "demo-auth-claim-test";

// `firebase emulators:exec` sets these env vars. We also fall back to
// localhost defaults so the test can be run manually too.
const AUTH_EMULATOR_HOST =
  process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";
const FIRESTORE_EMULATOR_HOST =
  process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";

// Ensure the Admin SDK targets the emulator before initializeApp().
process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_EMULATOR_HOST;
process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE_EMULATOR_HOST;

let adminApp: ReturnType<typeof initAdmin> | null = null;
let clientApp: ReturnType<typeof initClient> | null = null;

beforeAll(async () => {
  adminApp = initAdmin({ projectId: PROJECT_ID }, "admin-claim-test-admin");
  clientApp = initClient(
    {
      apiKey: "fake-api-key",
      projectId: PROJECT_ID,
      authDomain: `${PROJECT_ID}.firebaseapp.com`,
    },
    "admin-claim-test-client",
  );
  // Wire client SDK to emulators.
  const auth = getClientAuth(clientApp);
  const [authHost, authPort] = AUTH_EMULATOR_HOST.split(":");
  connectAuthEmulator(auth, `http://${authHost}:${authPort}`, { disableWarnings: true });
  const db = getFirestore(clientApp);
  const [fsHost, fsPort] = FIRESTORE_EMULATOR_HOST.split(":");
  connectFirestoreEmulator(db, fsHost!, Number(fsPort));
});

afterAll(async () => {
  if (clientApp) await deleteClientApp(clientApp);
  if (adminApp) await deleteApp(adminApp);
});

beforeEach(async () => {
  // Wipe Auth users between tests so user-id collisions don't bleed across.
  await fetch(
    `http://${AUTH_EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/accounts`,
    { method: "DELETE" },
  );
  // Wipe Firestore.
  await fetch(
    `http://${FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: "DELETE" },
  );
  // Make sure the client isn't carrying a stale signed-in user.
  await signOut(getClientAuth(clientApp!));
});

async function createUserAndSignIn(claims: Record<string, unknown>) {
  const adminAuth = getAdminAuth(adminApp!);
  const user = await adminAuth.createUser({ email: `u-${Date.now()}@test.local` });
  if (Object.keys(claims).length) {
    await adminAuth.setCustomUserClaims(user.uid, claims);
  }
  const customToken = await adminAuth.createCustomToken(user.uid);
  const clientAuth = getClientAuth(clientApp!);
  await signInWithCustomToken(clientAuth, customToken);
  // Force-refresh so newly-set custom claims appear in the ID token.
  await clientAuth.currentUser?.getIdToken(true);
  return user;
}

describe("admin claim end-to-end", () => {
  it("user with leagues.sfbl=admin CAN write a team", async () => {
    await createUserAndSignIn({ leagues: { sfbl: "admin" } });
    const db = getFirestore(clientApp!);
    await expect(
      setDoc(doc(db, "leagues/sfbl/teams/team_e2e_admin"), {
        name: "End-to-end admin write",
      }),
    ).resolves.toBeUndefined();
  });

  it("signed-in user with NO leagues claim CANNOT write a team", async () => {
    await createUserAndSignIn({});
    const db = getFirestore(clientApp!);
    await expect(
      setDoc(doc(db, "leagues/sfbl/teams/team_e2e_no_claim"), {
        name: "Should fail",
      }),
    ).rejects.toThrow(/permission/i);
  });

  it("user with admin claim for OTHER league CANNOT write here", async () => {
    await createUserAndSignIn({ leagues: { kcsl: "admin" } });
    const db = getFirestore(clientApp!);
    await expect(
      setDoc(doc(db, "leagues/sfbl/teams/team_e2e_wrong_league"), {
        name: "Should fail",
      }),
    ).rejects.toThrow(/permission/i);
  });
});
