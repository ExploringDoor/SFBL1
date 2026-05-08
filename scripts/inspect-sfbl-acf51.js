// Read-only audit of the sfbl-acf51 Firestore. Lists every root
// collection, plus the doc IDs inside the LeagueEngine paths we're
// about to write to (leagues/sfbl/*). Lets us decide whether to
// proceed with provision, switch to a different slug, or wipe first.

const path = require("path");
const { cert, initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

const SA_PATH = path.resolve(
  process.cwd(),
  "secrets/sfbl-acf51-service-account.json",
);
initializeApp({ credential: cert(SA_PATH), projectId: "sfbl-acf51" });
const db = getFirestore();

async function main() {
  console.log("=== Root collections ===");
  const root = await db.listCollections();
  if (root.length === 0) {
    console.log("(empty database — fully safe to provision)");
  } else {
    for (const c of root) {
      const snap = await c.limit(1).get();
      console.log(`  ${c.id}/  (${snap.size > 0 ? "has docs" : "empty"})`);
    }
  }

  console.log("\n=== leagues/sfbl ===");
  const lsfbl = await db.doc("leagues/sfbl").get();
  console.log(
    lsfbl.exists ? `  exists, fields: ${Object.keys(lsfbl.data() || {}).join(", ")}` : "  (does not exist — safe to provision)",
  );

  if (lsfbl.exists) {
    const subcollections = await lsfbl.ref.listCollections();
    if (subcollections.length === 0) {
      console.log("  no subcollections");
    } else {
      for (const c of subcollections) {
        const count = (await c.count().get()).data().count;
        console.log(`    leagues/sfbl/${c.id}/  ${count} doc(s)`);
      }
    }
  }

  console.log("\n=== tenants/sfbl ===");
  const tsfbl = await db.doc("tenants/sfbl").get();
  console.log(
    tsfbl.exists ? `  exists, fields: ${Object.keys(tsfbl.data() || {}).join(", ")}` : "  (does not exist — safe to provision)",
  );

  process.exit(0);
}

main().catch((e) => {
  console.error("inspect failed:", e.message);
  process.exit(1);
});
