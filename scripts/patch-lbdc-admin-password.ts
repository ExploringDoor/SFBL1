// Set `admin.passwordless = true` + `admin.password = "<value>"` on
// the LBDC tenant doc so /admin shows a password gate instead of the
// magic-link sign-in. The password lives ONLY in the source league
// doc; toPublicConfig() doesn't forward it, so a curious browser
// DevTools poke at the page payload can't lift it.
//
// Usage:
//   npx tsx scripts/patch-lbdc-admin-password.ts --league lbdc-staging --password lbdc2026
//   npx tsx scripts/patch-lbdc-admin-password.ts --league lbdc-staging --off   # turn off

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
let password: string | null = null;
let off = false;
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--league") league = args[++i] ?? null;
  else if (args[i] === "--password") password = args[++i] ?? null;
  else if (args[i] === "--off") off = true;
}
if (!league) {
  console.error(
    "Usage: --league <slug> --password <secret>   (or --off to disable)",
  );
  process.exit(2);
}
if (!off && !password) {
  console.error("Need --password or --off");
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
  const ref = db.doc(`leagues/${league}`);
  const snap = await ref.get();
  const cur = snap.exists ? snap.data()?.admin ?? {} : {};
  const next = off
    ? { ...cur, passwordless: false }
    : { ...cur, passwordless: true, password };
  await ref.set({ admin: next }, { merge: true });
  console.log(
    `[patch-admin-pw] /leagues/${league} admin.passwordless = ${!off}` +
      (off ? "" : "  (password set)"),
  );
  process.exit(0);
})();
