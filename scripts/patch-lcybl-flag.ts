// One-off: set flags.lmll_scoreboard on the LCYBL league config in the
// emulator without a full re-provision (which would re-seed teams/games and
// could stomp admin-entered GameChanger URLs). Targeted field update only.
import { getAdminDb } from "../lib/firebase-admin";

async function main() {
  const db = getAdminDb();
  const ref = db.collection("leagues").doc("lcybl");
  const snap = await ref.get();
  if (!snap.exists) {
    console.error("[patch] leagues/lcybl does not exist — provision first.");
    process.exit(1);
  }
  await ref.update({ "flags.lmll_scoreboard": true });
  const after = (await ref.get()).data();
  console.log("[patch] flags now:", JSON.stringify(after?.flags));
}

main().then(() => process.exit(0));
