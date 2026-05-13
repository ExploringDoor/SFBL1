import * as fs from "node:fs";
import * as path from "node:path";
(function loadEnvLocal() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const raw of fs.readFileSync(envPath, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    if (!process.env[m[1]!]) process.env[m[1]!] = (m[2] ?? "").trim().replace(/^['"]|['"]$/g, "");
  }
})();
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
initializeApp({ credential: cert(path.resolve(process.cwd(), process.env.FIREBASE_SERVICE_ACCOUNT_PATH!)), projectId: process.env.FIREBASE_PROJECT_ID });
const db = getFirestore();
(async () => {
  const tenant = await db.doc("leagues/lbdc-staging").get();
  console.log("TENANT:", JSON.stringify(tenant.data(), null, 2).slice(0, 400));
  const team = await db.doc("leagues/lbdc-staging/teams/black-sox").get();
  console.log("\nBLACK SOX:", JSON.stringify(team.data(), null, 2));
  const game = await db.doc("leagues/lbdc-staging/games/1").get();
  console.log("\nGAME 1:", JSON.stringify(game.data(), null, 2));
  const box = await db.doc("leagues/lbdc-staging/box_scores/1").get();
  const data = box.data() as any;
  console.log("\nBOX 1 (lineups truncated):");
  console.log("  away_lineup[0]:", JSON.stringify(data.away_lineup?.[0]));
  console.log("  home_lineup[0]:", JSON.stringify(data.home_lineup?.[0]));
  console.log("  away pitcher 0:", JSON.stringify(data.away_pitchers?.[0]));
  console.log("  linescore:", JSON.stringify(data.linescore));
  const count = await db.collection("leagues/lbdc-staging/games").count().get();
  console.log("\nGAMES COUNT:", count.data().count);
  process.exit(0);
})();
