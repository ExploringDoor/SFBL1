// CLI wrapper for lib/audit-tenant. Walks a single tenant's
// Firestore data and reports integrity issues. Run before flipping
// a tenant on for the first time, and weekly thereafter as a "did
// anything drift?" check. Mirrors the boot/init pattern of
// scripts/provision.ts.
//
// Usage:
//   npm run audit:tenant -- --league sfbl
//   npm run audit:tenant:emulator -- --league sfbl
//   npm run audit:tenant -- --league sfbl --json    # JSON output
//
// Exit code: 0 if clean, 1 if any issues, 2 if init/arg failure.

import * as fs from "node:fs";
import * as path from "node:path";

// Minimal env loader (matches scripts/provision.ts pattern).
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

function stripQuotes(v: string): string {
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
import { auditTenant, formatAuditReport } from "../lib/audit-tenant";

function parseArgs() {
  const args = process.argv.slice(2);
  let leagueId: string | null = null;
  let json = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--league") leagueId = args[++i] ?? null;
    else if (args[i] === "--json") json = true;
  }
  return { leagueId, json };
}

async function main() {
  const { leagueId, json } = parseArgs();
  if (!leagueId) {
    console.error(
      "[audit-tenant] Missing --league <slug>. Example:\n  npm run audit:tenant -- --league sfbl",
    );
    process.exit(2);
  }

  // ── Init firebase-admin ─────────────────────────────────────────
  const useEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
  const projectId = useEmulator
    ? process.env.GCLOUD_PROJECT ||
      process.env.FIREBASE_PROJECT_ID ||
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
      "demo-audit"
    : process.env.FIREBASE_PROJECT_ID ||
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

  if (!projectId) {
    console.error("[audit-tenant] No project ID resolved");
    process.exit(2);
  }

  if (useEmulator) {
    initializeApp({ projectId });
    console.error(
      `[audit-tenant] Emulator mode: ${process.env.FIRESTORE_EMULATOR_HOST} (project: ${projectId})`,
    );
  } else {
    const saJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    const saPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
    let credential;
    if (saJson) {
      try {
        credential = cert(JSON.parse(saJson));
      } catch (e) {
        console.error(
          `[audit-tenant] FIREBASE_SERVICE_ACCOUNT_JSON didn't parse: ${e instanceof Error ? e.message : e}`,
        );
        process.exit(2);
      }
    } else if (saPath) {
      const resolved = path.resolve(process.cwd(), saPath);
      if (!fs.existsSync(resolved)) {
        console.error(`[audit-tenant] Service account not found: ${resolved}`);
        process.exit(2);
      }
      credential = cert(resolved);
    } else {
      console.error(
        "[audit-tenant] No service account configured. Set FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT_PATH.",
      );
      process.exit(2);
    }
    initializeApp({ credential, projectId });
  }

  const db = getFirestore();

  // Verify the league exists before running checks.
  const leagueDoc = await db.doc(`leagues/${leagueId}`).get();
  if (!leagueDoc.exists) {
    console.error(`[audit-tenant] League not found: ${leagueId}`);
    process.exit(2);
  }

  const result = await auditTenant(db, leagueId);

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatAuditReport(result));
  }
  process.exit(result.issues.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(`[audit-tenant] failed: ${e instanceof Error ? e.message : e}`);
  process.exit(2);
});
