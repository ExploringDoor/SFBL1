// One-off: delete the `about` field from the live COYBL league doc so the
// homepage "Welcome" intro block renders nothing (Adam 2026-06-30). Surgical —
// touches ONLY leagues/coybl and ONLY the `about` field.
//
// Usage: FIREBASE_SERVICE_ACCOUNT_PATH=secrets/coybl-sa.json tsx scripts/coybl-remove-about.ts
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";

const saPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
if (!saPath) {
  console.error("Set FIREBASE_SERVICE_ACCOUNT_PATH to the SA key.");
  process.exit(1);
}
const sa = JSON.parse(readFileSync(saPath, "utf8"));
initializeApp({ credential: cert(sa), projectId: sa.project_id });
const db = getFirestore();

(async () => {
  const ref = db.doc("leagues/coybl");
  const before = (await ref.get()).data() ?? {};
  console.log("[project]", sa.project_id);
  console.log("[before] has about:", typeof before.about === "string", "| name:", before.name);
  await ref.update({ about: FieldValue.delete() });
  const after = (await ref.get()).data() ?? {};
  console.log("[after]  has about:", "about" in after);
  // Sanity: prove nothing else on the doc changed.
  const keysBefore = Object.keys(before).sort().join(",");
  const keysAfter = Object.keys(after).sort().join(",");
  const removed = keysBefore.split(",").filter((k) => !keysAfter.split(",").includes(k));
  console.log("[keys removed]", removed.join(",") || "(none)");
  console.log("[still present] flags.hide_page_titles:", after.flags?.hide_page_titles,
    "| admin.passwordless:", after.admin?.passwordless,
    "| theme.primary:", after.theme?.primary,
    "| tournaments events:", Array.isArray(after.tournaments?.events) ? after.tournaments.events.length : 0);
  process.exit(0);
})();
