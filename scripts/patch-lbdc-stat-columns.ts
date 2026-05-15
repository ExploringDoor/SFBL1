// Expand LBDC's `stat_columns` so the captain box-score editor
// surfaces all the columns the old LBDC Supabase site captured:
// AB, R, H, 2B, 3B, HR, RBI, BB, K, SB, HBP, SF, SAC, FC, ROE, CS.
// (Pitching columns are always all-in regardless of league config.)
//
// Run:
//   npx tsx scripts/patch-lbdc-stat-columns.ts --league lbdc-staging

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

// Match the BatStats fields the captain editor knows about. Order
// matters for the rendered column order in the editor.
const COLS = [
  "ab",
  "r",
  "h",
  "doubles",
  "triples",
  "hr",
  "rbi",
  "bb",
  "so",
  "sb",
  "hbp",
  "sf",
  "sac",
  "fc",
  "roe",
  "cs",
];

(async () => {
  const ref = db.doc(`leagues/${league}`);
  await ref.set({ stat_columns: COLS }, { merge: true });
  console.log(
    `[patch-stat-cols] /leagues/${league} stat_columns = [${COLS.join(", ")}]`,
  );
  process.exit(0);
})();
