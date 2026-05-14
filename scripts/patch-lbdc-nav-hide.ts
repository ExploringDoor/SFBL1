// Patch script — updates only the `nav.hide` field on the LBDC tenant
// doc. Cheaper / safer than re-running the full seed when all we need
// is to tweak which Nav links are suppressed for this tenant.
//
// Usage:
//   npx tsx scripts/patch-lbdc-nav-hide.ts --league lbdc-staging

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
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--league") league = args[++i] ?? null;
}
if (!league) {
  console.error("Usage: --league <slug>");
  process.exit(2);
}

initializeApp({
  credential: cert(
    path.resolve(process.cwd(), process.env.FIREBASE_SERVICE_ACCOUNT_PATH!),
  ),
  projectId: process.env.FIREBASE_PROJECT_ID,
});
const db = getFirestore();

// "About SFBL" intentionally absent — the Nav component now relabels
// it to "About <tenant abbrev>" for non-SFBL leagues, so LBDC sees a
// real "About LBDC" link backed by /sfbl-info (which reads tenant-
// specific content). Hiding it would leave LBDC without an about
// page entirely.
const HIDE = [
  "News",
  "Team Registration",
  "Team Waiver",
  "Store",
];

(async () => {
  const ref = db.doc(`leagues/${league}`);
  // Read-then-write so we keep any other nav.* keys (e.g. nav.order)
  // a future change might add. nav.hide is the only field we touch.
  const snap = await ref.get();
  const cur = snap.exists ? snap.data()?.nav ?? {} : {};
  const next = { ...cur, hide: HIDE };
  await ref.set({ nav: next }, { merge: true });
  console.log(
    `[patch-nav] /leagues/${league} nav.hide = ${JSON.stringify(HIDE)}`,
  );
  process.exit(0);
})();
