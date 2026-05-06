// Mark a list of game IDs as status="cancelled" in Firestore.
//
// Used to retire games that existed in an earlier import but no
// longer match the canonical schedule (e.g. matchup got rescheduled,
// game got rained out, etc.). Cancelled games are excluded from
// /schedule, /scores, /standings, and the ticker — but the doc
// stays so the audit trail is preserved.
//
// Usage:
//   FIRESTORE_EMULATOR_HOST=localhost:8080 \
//   GCLOUD_PROJECT=demo-sfbl \
//   npx tsx scripts/cancel-stale-games.ts \
//     --league sfbl g-0101 g-0102 g-0103 ...

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
    if (!process.env[k!]) process.env[k!] = (v ?? "").trim().replace(/^["']|["']$/g, "");
  }
})();

import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

function parseArgs() {
  const args = process.argv.slice(2);
  let league: string | null = null;
  const ids: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--league") league = args[++i] ?? null;
    else if (args[i]?.startsWith("--")) {
      // unknown flag, skip with value
      i++;
    } else {
      ids.push(args[i]!);
    }
  }
  return { league, ids };
}

async function main() {
  const { league, ids } = parseArgs();
  if (!league || ids.length === 0) {
    console.error(
      "Usage: tsx scripts/cancel-stale-games.ts --league <slug> <id1> <id2> ...",
    );
    process.exit(2);
  }

  const useEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
  const projectId = useEmulator
    ? process.env.GCLOUD_PROJECT ||
      process.env.FIREBASE_PROJECT_ID ||
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
      "demo-cancel"
    : process.env.FIREBASE_PROJECT_ID ||
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!projectId) {
    console.error("No project ID resolved");
    process.exit(2);
  }

  if (useEmulator) {
    initializeApp({ projectId });
    console.error(
      `[cancel-games] Emulator mode: ${process.env.FIRESTORE_EMULATOR_HOST} (project: ${projectId})`,
    );
  } else {
    const saJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    const saPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
    let credential;
    if (saJson) credential = cert(JSON.parse(saJson));
    else if (saPath) credential = cert(path.resolve(process.cwd(), saPath));
    else {
      console.error("No service account configured.");
      process.exit(2);
    }
    initializeApp({ credential, projectId });
  }

  const db = getFirestore();
  let updated = 0;
  let missing = 0;
  for (const id of ids) {
    const ref = db.doc(`leagues/${league}/games/${id}`);
    const snap = await ref.get();
    if (!snap.exists) {
      console.log(`  MISSING: ${id} (not in /games — already deleted?)`);
      missing++;
      continue;
    }
    await ref.set(
      {
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
        cancel_reason: "rescheduled — see replacement game",
      },
      { merge: true },
    );
    updated++;
    console.log(`  ✓ cancelled: ${id}`);
  }
  console.log(
    `\n[cancel-games] ${updated} cancelled, ${missing} missing (of ${ids.length} requested)`,
  );
}

main().catch((e) => {
  console.error(`[cancel-games] failed: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
