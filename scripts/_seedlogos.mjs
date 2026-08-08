import fs from "node:fs";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
const app = initializeApp(process.env.FIRESTORE_EMULATOR_HOST
  ? { projectId: process.env.GCLOUD_PROJECT }
  : { projectId: process.env.GCLOUD_PROJECT, credential: applicationDefault() });
const db = getFirestore(app);
const league = process.argv[2];
const manifest = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
const now = new Date().toISOString();
let n = 0;
const entries = Object.entries(manifest);
for (let i = 0; i < entries.length; i += 400) {
  const batch = db.batch();
  for (const [id, v] of entries.slice(i, i + 400)) {
    batch.set(db.doc(`leagues/${league}/teams/${id}`),
      { logo_url: v.logo_url, color: v.color, updated_at: now }, { merge: true });
    n++;
  }
  await batch.commit();
}
console.log("patched", n, "team logos");
process.exit(0);
