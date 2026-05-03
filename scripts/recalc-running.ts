// One-off: trigger recalcLeague against a running emulator, no auth required.
// Useful for verifying /players and /teams pages without going through
// the /api/recalc gate.

import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { recalcLeague } from "@/lib/stats";

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error("[recalc-running] FIRESTORE_EMULATOR_HOST not set");
  process.exit(1);
}

const projectId =
  process.env.GCLOUD_PROJECT ??
  process.env.FIREBASE_PROJECT_ID ??
  "league-platform-5f3c8";
const leagueId = process.argv[2] ?? "sfbl";

const app = initializeApp({ projectId }, "recalc-running");
const db = getFirestore(app);

recalcLeague(db, leagueId)
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
    return deleteApp(app);
  })
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
