// Delete every doc under /leagues/<slug>/<collection>. Used to wipe
// stale data before a fresh re-seed (e.g. when the transform filter
// excludes games that previously got written). Batched 400/op.
//
// Usage:
//   npx tsx scripts/clear-lbdc-collection.ts --league lbdc-staging --collection games
//   npx tsx scripts/clear-lbdc-collection.ts --league lbdc-staging --collection box_scores --yes

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

const args = process.argv.slice(2);
let league: string | null = null;
let collection: string | null = null;
let yes = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--league") league = args[++i] ?? null;
  else if (args[i] === "--collection") collection = args[++i] ?? null;
  else if (args[i] === "--yes") yes = true;
}
if (!league || !collection) {
  console.error("Usage: --league <slug> --collection <name> [--yes]");
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
  const ref = db.collection(`leagues/${league}/${collection}`);
  const snap = await ref.get();
  console.log(
    `Found ${snap.size} docs at /leagues/${league}/${collection}`,
  );
  if (snap.size === 0) return;
  if (!yes) {
    console.log("Pass --yes to actually delete.");
    return;
  }
  const docs = snap.docs;
  const BATCH = 400;
  let deleted = 0;
  for (let i = 0; i < docs.length; i += BATCH) {
    const batch = db.batch();
    for (const d of docs.slice(i, i + BATCH)) batch.delete(d.ref);
    await batch.commit();
    deleted += Math.min(BATCH, docs.length - i);
    process.stdout.write(`\r  deleted ${deleted}/${docs.length}…`);
  }
  console.log("\n  done.");
  process.exit(0);
})();
