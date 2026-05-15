// Flip captain.passwordless=true on the LBDC tenant doc so the
// captain landing page shows a team picker (no magic-link email) and
// /api/public-captain-claim accepts requests for this league.
//
// Usage:
//   npx tsx scripts/patch-lbdc-passwordless.ts --league lbdc-staging

import * as fs from "node:fs";
import * as path from "node:path";

(function loadEnvLocal() {
  const p = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(p)) return;
  for (const raw of fs.readFileSync(p, "utf8").split("\n")) {
    const m = raw.trim().match(/^([A-Z0-9_]+)=(.+)/);
    if (m && !process.env[m[1]!])
      process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
  }
})();

import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

let league: string | null = null;
let off = false;
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--league") league = args[++i] ?? null;
  else if (args[i] === "--off") off = true;
}
if (!league) {
  console.error("Usage: --league <slug> [--off]");
  process.exit(2);
}

initializeApp({
  credential: cert(
    path.resolve(process.cwd(), process.env.FIREBASE_SERVICE_ACCOUNT_PATH!),
  ),
  projectId: process.env.FIREBASE_PROJECT_ID,
});
const db = getFirestore();

(async () => {
  const ref = db.doc(`leagues/${league}`);
  const snap = await ref.get();
  const cur = snap.exists ? snap.data()?.captain ?? {} : {};
  const next = { ...cur, passwordless: !off };
  await ref.set({ captain: next }, { merge: true });
  console.log(
    `[patch-passwordless] /leagues/${league} captain.passwordless = ${!off}`,
  );
  process.exit(0);
})();
