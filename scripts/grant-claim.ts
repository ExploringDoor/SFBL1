// Bootstrap script: sets a `leagues.{leagueId}` custom claim on a Firebase
// Auth user via the Admin SDK. Use this to grant the FIRST admin of a
// tenant (or fix a broken claim manually). Once Phase 2c lands a Cloud
// Function for ongoing role management, this stays as the bootstrap path.
//
// Usage:
//   npm run grant-claim -- --email <email>  --league <slug> --role admin
//   npm run grant-claim -- --uid   <uid>    --league <slug> --role captain:team_a
//
// Modes:
//   • Emulator   FIRESTORE_EMULATOR_HOST + FIREBASE_AUTH_EMULATOR_HOST set
//                (auto-set by `firebase emulators:exec`). No service account
//                needed.
//   • Production FIREBASE_SERVICE_ACCOUNT_PATH must point at a downloaded
//                service account JSON. Treat that file like a password.

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
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

import { cert, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

interface Args {
  email?: string;
  uid?: string;
  league: string;
  role: string;
}

function parseArgs(argv: string[]): Args {
  const out: Partial<Args> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--email") {
      out.email = next;
      i++;
    } else if (arg === "--uid") {
      out.uid = next;
      i++;
    } else if (arg === "--league") {
      out.league = next;
      i++;
    } else if (arg === "--role") {
      out.role = next;
      i++;
    }
  }
  if (!out.league || !out.role || (!out.email && !out.uid)) {
    console.error(
      "Usage: npm run grant-claim -- --email <email> --league <slug> --role <admin|captain:teamId|player:playerId>",
    );
    console.error("   or: npm run grant-claim -- --uid <uid> --league <slug> --role <role>");
    process.exit(1);
  }
  return out as Args;
}

function validateRole(role: string): void {
  if (role === "admin") return;
  // Closes audit M5. Tighten the slug character class to match
  // what the production claim-set paths (admin-grant-claim,
  // admin-bulk-invite) enforce. The previous loose [^:]+ would
  // accept a teamId like "a.*" which interpolates into
  // firestore.rules' isCaptainOfDocGame regex (docId.matches(
  // '^.+_' + teamId + '$')) and over-matches docs that aren't
  // the captain's. Production grants run this validator too via
  // the admin-* API routes, but this script is the bootstrap
  // path Adam uses to seed the first admin — keep the rules
  // contract intact even there.
  if (/^captain:[a-z0-9_-]+$/.test(role)) return;
  if (/^player:[a-z0-9_-]+$/.test(role)) return;
  console.error(
    `Invalid role "${role}". Must be "admin", "captain:<teamId>", or "player:<playerId>" with [a-z0-9_-] slug.`,
  );
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));
validateRole(args.role);

const useEmulator = Boolean(
  process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST,
);

const projectId = useEmulator
  ? process.env.GCLOUD_PROJECT ||
    process.env.FIREBASE_PROJECT_ID ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
    "demo-grant-claim"
  : process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

if (!projectId) {
  console.error("[grant-claim] No project ID. Set NEXT_PUBLIC_FIREBASE_PROJECT_ID in .env.local.");
  process.exit(1);
}

if (useEmulator) {
  initializeApp({ projectId });
  console.log(
    `[grant-claim] Using emulators (auth: ${process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "(none)"})`,
  );
} else {
  const saPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (!saPath) {
    console.error(
      "[grant-claim] FIREBASE_SERVICE_ACCOUNT_PATH not set. See .env.local.example for setup.",
    );
    process.exit(1);
  }
  const resolvedSa = path.resolve(process.cwd(), saPath);
  if (!fs.existsSync(resolvedSa)) {
    console.error(`[grant-claim] Service account file not found: ${resolvedSa}`);
    process.exit(1);
  }
  initializeApp({ credential: cert(resolvedSa), projectId });
  console.log(`[grant-claim] Using service account at ${saPath} (project: ${projectId})`);
}

async function run() {
  const auth = getAuth();
  const user = args.email
    ? await auth.getUserByEmail(args.email).catch(() => null)
    : await auth.getUser(args.uid!).catch(() => null);

  if (!user) {
    console.error(
      `[grant-claim] No user found for ${args.email ? `email "${args.email}"` : `uid "${args.uid}"`}.\n` +
        "User must sign in via the magic-link flow at least once before claims can be set.",
    );
    process.exit(1);
  }

  const existing = (user.customClaims?.leagues as Record<string, string> | undefined) ?? {};
  const updated = { ...existing, [args.league]: args.role };
  await auth.setCustomUserClaims(user.uid, {
    ...(user.customClaims ?? {}),
    leagues: updated,
  });

  console.log(`[grant-claim] Done.`);
  console.log(`  uid:    ${user.uid}`);
  console.log(`  email:  ${user.email ?? "(none)"}`);
  console.log(`  before: leagues = ${JSON.stringify(existing)}`);
  console.log(`  after:  leagues = ${JSON.stringify(updated)}`);
  console.log(
    "\nThe user's existing ID token still has the old claims. They take effect on next " +
      "token refresh (~1 hour) or after sign-out/sign-in.",
  );
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[grant-claim] Failed:", err);
    process.exit(1);
  });
