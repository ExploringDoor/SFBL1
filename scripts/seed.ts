// Seeds Firestore with one tenant config doc at /leagues/sfbl.
//
// Uses the Firebase Admin SDK, which BYPASSES security rules — that's
// the point. Two run modes:
//
//   • Emulator mode  (npm run seed:emulator)
//     Firebase CLI sets FIRESTORE_EMULATOR_HOST + GCLOUD_PROJECT for us.
//     No credentials needed. Safe to run anytime.
//
//   • Production mode  (npm run seed)
//     Requires FIREBASE_SERVICE_ACCOUNT_PATH pointing to a service
//     account JSON. Treat that file like a password — it grants full
//     cross-tenant read/write.
//
// The Admin SDK bypassing rules is exactly why we have an emulator-mode
// CI gate (npm run test:rules) — rules unit tests verify the rules,
// not the Admin SDK code path.

import * as fs from "node:fs";
import * as path from "node:path";

// Load .env.local without adding a dotenv dep.
(function loadEnvLocal() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const raw of fs.readFileSync(envPath, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    const [, k, v] = m;
    if (!process.env[k!]) process.env[k!] = stripQuotes(v ?? "");
  }
})();

function stripQuotes(v: string) {
  const t = v.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

import { cert, initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import type { LeagueConfig } from "../lib/types";

const useEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

const projectId = useEmulator
  ? process.env.GCLOUD_PROJECT ||
    process.env.FIREBASE_PROJECT_ID ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
    "demo-seed-smoke"
  : process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

if (!projectId) {
  console.error(
    "[seed] No project ID. Set NEXT_PUBLIC_FIREBASE_PROJECT_ID in .env.local " +
      "or run against the emulator: npm run seed:emulator",
  );
  process.exit(1);
}

if (useEmulator) {
  // Emulator: no credentials needed. Admin SDK auto-detects via env.
  initializeApp({ projectId });
  console.log(
    `[seed] Connecting to Firestore emulator at ${process.env.FIRESTORE_EMULATOR_HOST} (project: ${projectId})`,
  );
} else {
  const saPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (!saPath) {
    console.error(
      "[seed] FIREBASE_SERVICE_ACCOUNT_PATH not set in .env.local.\n\n" +
        "To seed PROD Firestore:\n" +
        "  1. Firebase Console → ⚙ Project settings → Service accounts\n" +
        "  2. Click 'Generate new private key' → download the JSON\n" +
        "  3. mkdir secrets && mv ~/Downloads/<the-file>.json secrets/service-account.json\n" +
        "  4. Add to .env.local: FIREBASE_SERVICE_ACCOUNT_PATH=./secrets/service-account.json\n" +
        "  5. Re-run npm run seed\n\n" +
        "Or for a safe smoke test, run against the emulator instead:\n" +
        "  npm run seed:emulator",
    );
    process.exit(1);
  }
  const resolvedSa = path.resolve(process.cwd(), saPath);
  if (!fs.existsSync(resolvedSa)) {
    console.error(`[seed] Service account file not found: ${resolvedSa}`);
    process.exit(1);
  }
  initializeApp({
    credential: cert(resolvedSa),
    projectId,
  });
  console.log(`[seed] Using service account at ${saPath} (project: ${projectId})`);
}

const db = getFirestore();

const sfbl: LeagueConfig = {
  slug: "sfbl",
  name: "South Florida Baseball",
  sport: "baseball",
  innings: 9,
  ruleset: "hardball",
  linescore_innings: 9,
  stat_columns: ["AB", "R", "H", "2B", "3B", "HR", "RBI", "BB", "SO", "SB"],
  pitching: {
    tracked: true,
    columns: ["IP", "H", "R", "ER", "BB", "SO", "HR"],
  },
  rules_flags: {
    dropped_third_strike: true,
    balks: true,
    infield_fly: true,
  },
  theme: {
    primary: "#0c4a6e",
    accent: "#f59e0b",
  },
  billing: {
    status: "active",
    paid_through: null,
    last_payment: null,
    notes: "Phase 1 seed; manual billing not yet tracked.",
  },
  flags: {
    new_box_score_editor: false,
    pdf_vision_upload: false,
    fcm_push: false,
  },
};

async function run() {
  console.log(`[seed] Writing /leagues/${sfbl.slug} …`);
  await db.doc(`leagues/${sfbl.slug}`).set(sfbl);
  // Read it back so we can prove the round-trip worked, especially for
  // the emulator smoke test in CI.
  const snap = await db.doc(`leagues/${sfbl.slug}`).get();
  if (!snap.exists) throw new Error("Doc did not appear after write");
  console.log(`[seed] Verified: ${snap.id} = ${(snap.data() as LeagueConfig).name}`);
  console.log("[seed] Done.");
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[seed] Failed:", err);
    process.exit(1);
  });

// Suppress an unused-import warning when not using applicationDefault().
void applicationDefault;
