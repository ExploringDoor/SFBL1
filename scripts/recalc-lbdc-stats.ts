// Run the platform's recalcLeague() against production Firestore
// for a specific tenant. Aggregates every /box_scores/{gameId} into
// per-player season stats written to /players/{id}.stats and
// /players/{id}.pitching. Called once after the LBDC seed so the
// /leaders, /players, /teams/[id], and player-profile pages have
// numbers to render.
//
// Usage:
//   npx tsx scripts/recalc-lbdc-stats.ts --league lbdc-staging

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
import { recalcLeague } from "@/lib/stats";

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

(async () => {
  console.log(`[recalc] running recalcLeague for /leagues/${league}/`);
  const result = await recalcLeague(db, league!);
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
})();
