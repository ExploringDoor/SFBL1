// Configure one scoped admin password on a league — the town commissioner
// passwords for ETBL, or Island's umpires / scheduler roles.
//
// Writes leagues/{league}.admin.roles.{role} = { password, scopes?, town? }.
// The shape is what /api/public-admin-claim reads; what the role then OPENS is
// decided by lib/admin-roles.ts (resolveConfiguredRole), which this script
// runs first so a role that would mint nothing is refused here, at the
// keyboard, instead of failing silently at the login box.
//
// Usage:
//   npm run set-admin-role -- --league etbl --role mineola \
//       --town "Mineola" --scopes scores,volunteers --password 'xxxx'
//   npm run set-admin-role -- --league island --role umpires --password 'xxxx'
//   npm run set-admin-role -- --league etbl --role mineola --remove
//
//   npm run set-admin-role:emulator -- ...     (same flags, local emulator)
//
// Seven towns typed by hand into the Firestore console is the error-prone
// step of an ETBL launch; this is the alternative. The password is never
// echoed back.
//
// Modes:
//   • Emulator   FIRESTORE_EMULATOR_HOST set (the :emulator script does it).
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
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import {
  ADMIN_ROLES,
  ALL_SCOPES,
  ROLE_ID_RE,
  resolveConfiguredRole,
} from "../lib/admin-roles";

interface Args {
  league: string;
  role: string;
  password?: string;
  scopes?: string[];
  town?: string;
  remove: boolean;
}

function usage(): never {
  console.error(
    [
      "Usage:",
      "  npm run set-admin-role -- --league <slug> --role <id> --password <pw> [--scopes a,b] [--town <name>]",
      "  npm run set-admin-role -- --league <slug> --role <id> --remove",
      "",
      `Role ids must match ${ROLE_ID_RE} (lowercase letters and hyphens).`,
      `Known table roles: ${Object.keys(ADMIN_ROLES).join(", ")} (scopes come from the code).`,
      `Scopes for other roles: ${ALL_SCOPES.join(", ")}.`,
      "A --town narrows the role to the town-scoped routes (scores, volunteers).",
    ].join("\n"),
  );
  process.exit(1);
}

function parseArgs(argv: string[]): Args {
  const out: Partial<Args> = { remove: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--league") {
      out.league = next;
      i++;
    } else if (arg === "--role") {
      out.role = next;
      i++;
    } else if (arg === "--password") {
      out.password = next;
      i++;
    } else if (arg === "--scopes") {
      out.scopes = String(next ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      i++;
    } else if (arg === "--town") {
      out.town = next;
      i++;
    } else if (arg === "--remove") {
      out.remove = true;
    }
  }
  if (!out.league || !out.role) usage();
  if (!out.remove && !out.password) usage();
  return out as Args;
}

const args = parseArgs(process.argv.slice(2));

if (!/^[a-z0-9][a-z0-9-]*$/.test(args.league)) {
  console.error(`[set-admin-role] bad league slug "${args.league}"`);
  process.exit(1);
}
if (!ROLE_ID_RE.test(args.role)) {
  console.error(
    `[set-admin-role] role id "${args.role}" must match ${ROLE_ID_RE} — ` +
      `it ends up inside a Firestore rules regex.`,
  );
  process.exit(1);
}

// Resolve BEFORE touching Firestore, exactly as the login route will.
const resolved = args.remove
  ? null
  : resolveConfiguredRole(args.role, {
      scopes: args.scopes,
      town: args.town,
    });
if (!args.remove && !resolved) {
  console.error(
    `[set-admin-role] "${args.role}" would open nothing and will not be written. ` +
      (ADMIN_ROLES[args.role]
        ? `It is a table role; a --town can only keep scopes in TOWN_SCOPES.`
        : `Give it --scopes from: ${ALL_SCOPES.join(", ")}${
            args.town ? " (a --town keeps only scores/volunteers)" : ""
          }.`),
  );
  process.exit(1);
}
if (!args.remove && args.password!.length < 6) {
  console.error("[set-admin-role] password must be at least 6 characters");
  process.exit(1);
}

const useEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const projectId = useEmulator
  ? process.env.GCLOUD_PROJECT ||
    process.env.FIREBASE_PROJECT_ID ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
    "demo-set-admin-role"
  : process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

if (!projectId) {
  console.error(
    "[set-admin-role] No project ID. Set NEXT_PUBLIC_FIREBASE_PROJECT_ID in .env.local.",
  );
  process.exit(1);
}

if (useEmulator) {
  initializeApp({ projectId });
  console.log(`[set-admin-role] Using emulator at ${process.env.FIRESTORE_EMULATOR_HOST}`);
} else {
  const saPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (!saPath) {
    console.error(
      "[set-admin-role] FIREBASE_SERVICE_ACCOUNT_PATH not set. See .env.local.example for setup.",
    );
    process.exit(1);
  }
  const resolvedSa = path.resolve(process.cwd(), saPath);
  if (!fs.existsSync(resolvedSa)) {
    console.error(`[set-admin-role] Service account file not found: ${resolvedSa}`);
    process.exit(1);
  }
  initializeApp({ credential: cert(resolvedSa), projectId });
  console.log(`[set-admin-role] Using service account at ${saPath} (project: ${projectId})`);
}

async function run() {
  const db = getFirestore();
  const ref = db.doc(`leagues/${args.league}`);
  const snap = await ref.get();
  if (!snap.exists) {
    console.error(
      `[set-admin-role] leagues/${args.league} does not exist — provision the tenant first.`,
    );
    process.exit(1);
  }

  if (args.remove) {
    await ref.update({ [`admin.roles.${args.role}`]: FieldValue.delete() });
    console.log(`[set-admin-role] Removed role "${args.role}" from ${args.league}.`);
    return;
  }

  const entry: Record<string, unknown> = { password: args.password };
  if (!ADMIN_ROLES[args.role]) entry.scopes = resolved!.scopes;
  if (resolved!.town) entry.town = resolved!.town;

  // Nested merge: only this role's map is touched, every other role and the
  // rest of `admin` (passwordless, the full password) stay as they are.
  await ref.set({ admin: { roles: { [args.role]: entry } } }, { merge: true });

  const passwordless = (snap.data()?.admin as { passwordless?: unknown } | undefined)
    ?.passwordless === true;
  console.log(`[set-admin-role] Done.`);
  console.log(`  league: ${args.league}`);
  console.log(`  role:   ${args.role}${ADMIN_ROLES[args.role] ? " (table role)" : ""}`);
  console.log(`  scopes: ${resolved!.scopes.join(", ")}`);
  console.log(`  town:   ${resolved!.town ?? "(none)"}`);
  console.log(`  login:  /admin → type the password → lands on ${resolved!.scopes[0]} tab`);
  if (!passwordless) {
    console.warn(
      "\n  ⚠ admin.passwordless is not true on this league — the password box will " +
        "not appear until it is (or until <SLUG>_ADMIN_PASSWORD is set in the env).",
    );
  }
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[set-admin-role] Failed:", err);
    process.exit(1);
  });
