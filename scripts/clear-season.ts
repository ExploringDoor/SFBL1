// Season rollover: clear a league's teams and games so a new season starts
// clean. COYBL rebuilds from scratch every year — coaches register fresh,
// teams are created from those registrations, and standings compute from the
// games actually played.
//
// WHY THIS IS NEEDED: while last season's teams still carry a stored w/l
// record, the standings pages show those frozen numbers and any new team
// renders blank. Clearing is what makes standings live again.
//
// BEFORE RUNNING, the season being cleared must already be archived:
//   data/<tenant>/historical-standings.json   final standings
//   data/<tenant>/season-games-<year>.json    game results (the Scores tab)
// Both are static files, so they survive this completely.
//
// Usage (dry run is the default; nothing is deleted without DRY=0):
//   SA_PATH=/path/to/service-account.json TENANT=coybl npx tsx scripts/clear-season.ts
//   SA_PATH=... TENANT=coybl DRY=0 npx tsx scripts/clear-season.ts
//
// Scoped to exactly two collections under leagues/<tenant>. Registrations,
// page content, config, payments, pitch outings and everything else are
// deliberately left alone.

import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { readFileSync, existsSync } from "node:fs";

const SA_PATH = process.env.SA_PATH;
const TENANT = process.env.TENANT;
const DRY = process.env.DRY !== "0";
const TARGETS = ["teams", "games"] as const;

if (!SA_PATH || !existsSync(SA_PATH)) {
  console.error("SA_PATH must point at a service-account JSON file.");
  process.exit(1);
}
if (!TENANT || !/^[a-z][a-z0-9-]*$/.test(TENANT)) {
  console.error("TENANT is required, e.g. TENANT=coybl");
  process.exit(1);
}

const sa = JSON.parse(readFileSync(SA_PATH, "utf8")) as {
  project_id: string;
};
initializeApp({ credential: cert(SA_PATH), projectId: sa.project_id });
const db = getFirestore();

async function main() {
  console.log(
    `project ${sa.project_id} · tenant ${TENANT} · ${DRY ? "DRY RUN" : "DELETING"}`,
  );

  for (const coll of TARGETS) {
    const path = `leagues/${TENANT}/${coll}`;
    const snap = await db.collection(path).get();
    console.log(`${path}: ${snap.size} docs`);
    if (DRY || snap.empty) continue;

    let batch = db.batch();
    let pending = 0;
    let deleted = 0;
    for (const doc of snap.docs) {
      batch.delete(doc.ref);
      pending += 1;
      // Firestore caps a batch at 500 writes.
      if (pending === 400) {
        await batch.commit();
        deleted += pending;
        batch = db.batch();
        pending = 0;
      }
    }
    if (pending) {
      await batch.commit();
      deleted += pending;
    }
    console.log(`  deleted ${deleted}`);
  }

  for (const coll of TARGETS) {
    const s = await db.collection(`leagues/${TENANT}/${coll}`).get();
    console.log(`after: leagues/${TENANT}/${coll} = ${s.size}`);
  }
  if (DRY) console.log("\nDry run only. Re-run with DRY=0 to delete.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
