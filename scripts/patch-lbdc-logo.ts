// Patch script — points the LBDC tenant doc's theme.logo_url at the
// new square logo asset Adam dropped into public/lbdc/logo.png on
// 2026-05-14. The previous value (/lbdc/hero.jpg, the wide banner)
// showed up in three places (ticker + Nav brand + hero) which read
// as redundant; the new transparent-PNG square works better in the
// 48px ticker tile and the homepage hero.
//
// Run:
//   npx tsx scripts/patch-lbdc-logo.ts --league lbdc-staging

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

// Two assets:
//   - logo_url:   small square icon for the top-left ticker tile,
//                 OG share-card fallback, PWA manifest icon.
//   - banner_url: wide banner used as the homepage Hero only.
//                 Adam keeps the original LBDC banner art there.
const NEW_LOGO = "/lbdc/logo.png";
const HERO_BANNER = "/lbdc/hero.jpg";

(async () => {
  const ref = db.doc(`leagues/${league}`);
  const snap = await ref.get();
  const cur = snap.exists ? snap.data()?.theme ?? {} : {};
  const next = { ...cur, logo_url: NEW_LOGO, banner_url: HERO_BANNER };
  await ref.set({ theme: next }, { merge: true });
  console.log(
    `[patch-logo] /leagues/${league} theme.logo_url=${NEW_LOGO} banner_url=${HERO_BANNER}`,
  );
  process.exit(0);
})();
