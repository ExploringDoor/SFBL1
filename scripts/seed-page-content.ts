// Write a markdown file straight into a tenant's page_content
// collection. Used for one-off pre-launch hydration when the admin
// claim hasn't been granted yet (chicken/egg: you need to sign in
// once to get the claim, but to sign in you need a deployed site).
//
// Usage:
//   npm run seed:page -- --league sfbl --page rules --file data/sfbl/rules.md
//   npm run seed:page:emulator -- --league sfbl --page rules --file data/sfbl/rules.md
//
// Writes to: /leagues/{league}/page_content/{page} with shape
//   { markdown: <file contents>, updated_at: ISO, updated_by_uid: 'seed-script' }

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
    if (!process.env[k!]) {
      const t = (v ?? "").trim();
      process.env[k!] =
        (t.startsWith('"') && t.endsWith('"')) ||
        (t.startsWith("'") && t.endsWith("'"))
          ? t.slice(1, -1)
          : t;
    }
  }
})();

import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

function parseArgs() {
  const args = process.argv.slice(2);
  let league: string | null = null;
  let page: string | null = null;
  let file: string | null = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--league") league = args[++i] ?? null;
    else if (args[i] === "--page") page = args[++i] ?? null;
    else if (args[i] === "--file") file = args[++i] ?? null;
  }
  return { league, page, file };
}

async function main() {
  const { league, page, file } = parseArgs();
  if (!league || !page || !file) {
    console.error(
      "Usage: tsx scripts/seed-page-content.ts --league <slug> --page <id> --file <path>",
    );
    process.exit(2);
  }

  const filePath = path.resolve(process.cwd(), file);
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(2);
  }
  const markdown = fs.readFileSync(filePath, "utf8");

  const useEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
  const projectId = useEmulator
    ? process.env.GCLOUD_PROJECT ||
      process.env.FIREBASE_PROJECT_ID ||
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
      "demo-seed"
    : process.env.FIREBASE_PROJECT_ID ||
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

  if (!projectId) {
    console.error("No project ID resolved");
    process.exit(2);
  }

  if (useEmulator) {
    initializeApp({ projectId });
    console.error(
      `[seed:page] Emulator mode: ${process.env.FIRESTORE_EMULATOR_HOST} (project: ${projectId})`,
    );
  } else {
    const saJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    const saPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
    let credential;
    if (saJson) {
      credential = cert(JSON.parse(saJson));
    } else if (saPath) {
      const resolved = path.resolve(process.cwd(), saPath);
      if (!fs.existsSync(resolved)) {
        console.error(`Service account not found: ${resolved}`);
        process.exit(2);
      }
      credential = cert(resolved);
    } else {
      console.error(
        "No service account configured. Set FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT_PATH.",
      );
      process.exit(2);
    }
    initializeApp({ credential, projectId });
  }

  const db = getFirestore();
  const docPath = `leagues/${league}/page_content/${page}`;
  await db.doc(docPath).set(
    {
      markdown,
      updated_at: new Date().toISOString(),
      updated_by_uid: "seed-script",
    },
    { merge: true },
  );
  console.log(
    `[seed:page] Wrote ${markdown.length} chars to /${docPath}`,
  );
}

main().catch((e) => {
  console.error(`[seed:page] failed: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
