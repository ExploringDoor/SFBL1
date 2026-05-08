// One-off: populate `logo_url` on every team where we have a matching
// PNG in `public/logos/{leagueId}/{teamId}.png`.
//
// Why this exists:
//   We started SFBL with logos checked in but `logo_url` blank in
//   teams.csv (the provision pipeline didn't auto-link them, so they
//   just sat in /public unused). Without this field set, every UI
//   component that does `team.logo_url ? <img/> : <initials/>` falls
//   back to initials — which makes the homepage, standings, and
//   /history all look like the league has no branding.
//
// What it does:
//   1. Walks every team in `leagues/{leagueId}/teams`.
//   2. For each team without a logo_url, checks if
//      `public/logos/{leagueId}/{teamId}.png` exists.
//   3. If yes, sets `logo_url = /logos/{leagueId}/{teamId}.png`.
//   4. Also rewrites `data/{leagueId}/teams.csv` to keep the
//      provisioning source-of-truth in sync (so re-provisioning
//      doesn't blow this away).
//
// Auth: same emulator/service-account pattern as scripts/grant-claim.ts.
//
// Usage:
//   npm run set-team-logos -- --league sfbl                 # dry run
//   npm run set-team-logos -- --league sfbl --apply         # write

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
    const [, k, v] = m;
    if (!process.env[k!]) process.env[k!] = stripQuotes(v ?? "");
  }
})();

function stripQuotes(v: string) {
  const t = v.trim();
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    return t.slice(1, -1);
  }
  return t;
}

import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

function parseArgs(argv: string[]): { league: string; apply: boolean } {
  let league = "";
  let apply = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--league") {
      league = argv[i + 1] ?? "";
      i++;
    } else if (argv[i] === "--apply") {
      apply = true;
    }
  }
  if (!league) {
    console.error(
      "Usage: npx tsx scripts/set-team-logos.ts --league <slug> [--apply]",
    );
    process.exit(1);
  }
  return { league, apply };
}

const args = parseArgs(process.argv.slice(2));

// Auth bootstrap — same shape as grant-claim.ts.
const useEmulator = !!(
  process.env.FIRESTORE_EMULATOR_HOST ||
  process.env.FIREBASE_AUTH_EMULATOR_HOST
);
const projectId = useEmulator
  ? process.env.GCLOUD_PROJECT ||
    process.env.FIREBASE_PROJECT_ID ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
    "demo-set-logos"
  : process.env.FIREBASE_PROJECT_ID ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

if (!projectId) {
  console.error("[set-team-logos] No project ID set.");
  process.exit(1);
}

if (useEmulator) {
  initializeApp({ projectId });
  console.log(
    `[set-team-logos] Using emulator (host: ${process.env.FIRESTORE_EMULATOR_HOST ?? "(none)"})`,
  );
} else {
  const saPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (!saPath) {
    console.error(
      "[set-team-logos] FIREBASE_SERVICE_ACCOUNT_PATH not set in .env.local.",
    );
    process.exit(1);
  }
  const resolvedSa = path.resolve(process.cwd(), saPath);
  if (!fs.existsSync(resolvedSa)) {
    console.error(
      `[set-team-logos] Service account file not found: ${resolvedSa}`,
    );
    process.exit(1);
  }
  initializeApp({ credential: cert(resolvedSa), projectId });
  console.log(
    `[set-team-logos] Using service account (project: ${projectId})`,
  );
}

async function run() {
  const db = getFirestore();
  const logosDir = path.resolve(
    process.cwd(),
    `public/logos/${args.league}`,
  );

  const teamsRef = db.collection(`leagues/${args.league}/teams`);
  const snap = await teamsRef.get();
  console.log(
    `[set-team-logos] Found ${snap.size} teams in leagues/${args.league}/teams`,
  );

  type Plan = { id: string; existing: string | null; next: string };
  const updates: Plan[] = [];
  const skipped: { id: string; reason: string }[] = [];

  for (const doc of snap.docs) {
    const data = doc.data();
    const existing =
      typeof data.logo_url === "string" && data.logo_url
        ? data.logo_url
        : null;
    const file = path.join(logosDir, `${doc.id}.png`);
    if (!fs.existsSync(file)) {
      skipped.push({ id: doc.id, reason: "no logo file" });
      continue;
    }
    const next = `/logos/${args.league}/${doc.id}.png`;
    if (existing === next) {
      skipped.push({ id: doc.id, reason: "already set" });
      continue;
    }
    updates.push({ id: doc.id, existing, next });
  }

  console.log(`\n[plan] would update ${updates.length} teams:`);
  for (const u of updates) {
    console.log(
      `  ${u.id.padEnd(24)} ${u.existing ?? "(none)"} → ${u.next}`,
    );
  }
  if (skipped.length > 0) {
    console.log(`\n[plan] skipping ${skipped.length}:`);
    for (const s of skipped) {
      console.log(`  ${s.id.padEnd(24)} (${s.reason})`);
    }
  }

  if (!args.apply) {
    console.log("\n[plan] dry run only. Re-run with --apply to write.");
    return;
  }

  console.log(`\n[apply] writing ${updates.length} updates…`);
  // Batched writes — Firestore admin SDK caps at 500, we have ~30.
  const batch = db.batch();
  for (const u of updates) {
    batch.update(teamsRef.doc(u.id), { logo_url: u.next });
  }
  await batch.commit();
  console.log(`[apply] done.`);

  // Sync the CSV so re-provisioning doesn't blow this away.
  const csvPath = path.resolve(
    process.cwd(),
    `data/${args.league}/teams.csv`,
  );
  if (fs.existsSync(csvPath)) {
    const lines = fs.readFileSync(csvPath, "utf8").split("\n");
    const header = lines[0]!;
    const cols = header.split(",");
    const idCol = cols.indexOf("id");
    const logoCol = cols.indexOf("logo_url");
    if (idCol === -1 || logoCol === -1) {
      console.warn(
        `[apply] csv at ${csvPath} missing id/logo_url columns; skipping CSV sync.`,
      );
      return;
    }
    const idToLogo = new Map<string, string>();
    for (const u of updates) idToLogo.set(u.id, u.next);

    const rewritten = [header];
    for (let i = 1; i < lines.length; i++) {
      const row = lines[i] ?? "";
      if (!row.trim()) {
        rewritten.push(row);
        continue;
      }
      const fields = row.split(",");
      const id = (fields[idCol] ?? "").trim();
      const newLogo = idToLogo.get(id);
      if (newLogo && !(fields[logoCol] ?? "").trim()) {
        fields[logoCol] = newLogo;
      }
      rewritten.push(fields.join(","));
    }
    fs.writeFileSync(csvPath, rewritten.join("\n"));
    console.log(`[apply] synced ${csvPath}`);
  }
}

run()
  .catch((e) => {
    console.error(
      `[set-team-logos] failed: ${e instanceof Error ? e.message : e}`,
    );
    process.exit(1);
  })
  .finally(() => {
    // Firestore admin keeps the process alive on idle gRPC streams;
    // force-exit so the script terminates cleanly.
    setTimeout(() => process.exit(0), 100);
  });
