// One-time migration: move a league's admin sign-in password OFF the
// world-readable /leagues/{id} config doc and INTO the Admin-SDK-only
// /leagues/{id}/_secrets/admin doc.
//
// Why: /leagues/{id} is `allow read: if true` so Edge middleware can
// resolve tenant config before auth. An older setup wrote admin.password
// (plaintext) onto that doc, so any unauthenticated visitor could read it
// and mint an admin token (2026-08 audit CRITICAL). This scrubs it.
//
// SAFE + idempotent:
//   - Reads the current admin.password.
//   - Backs the whole `admin` map up to a local JSON file BEFORE writing.
//   - Copies the password to _secrets/admin, then deletes admin.password
//     from the public doc. The `passwordless` flag stays on the public doc.
//   - Re-running after migration is a no-op ("nothing to migrate").
//
// Usage (dry-run prints what it WOULD do, writes nothing):
//   FIREBASE_SERVICE_ACCOUNT_PATH=secrets/<sa>.json FIREBASE_PROJECT_ID=<proj> \
//     npx tsx scripts/migrations/move-admin-password-to-secret.ts --league <slug> --dry-run
//
// Apply:
//   FIREBASE_SERVICE_ACCOUNT_PATH=secrets/<sa>.json FIREBASE_PROJECT_ID=<proj> \
//     npx tsx scripts/migrations/move-admin-password-to-secret.ts --league <slug>

import * as fs from "node:fs";
import * as path from "node:path";
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const league = arg("league");
const dryRun = process.argv.includes("--dry-run");

if (!league) {
  console.error(
    "Usage: --league <slug> [--dry-run]\n" +
      "  env: FIREBASE_SERVICE_ACCOUNT_PATH, FIREBASE_PROJECT_ID",
  );
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
  if (!snap.exists) {
    console.error(`[move-admin-pw] league "${league}" not found`);
    process.exit(1);
  }
  const admin = (snap.data()?.admin ?? {}) as Record<string, unknown>;
  const password = admin.password;

  if (typeof password !== "string" || !password) {
    console.log(
      `[move-admin-pw] /leagues/${league}: no admin.password on the public ` +
        `doc — nothing to migrate. (passwordless=${admin.passwordless === true})`,
    );
    process.exit(0);
  }

  // Back up the whole admin map before touching anything.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.resolve(
    process.cwd(),
    `_backup_admin_${league}_${stamp}.json`,
  );

  if (dryRun) {
    console.log(
      `[move-admin-pw] DRY RUN /leagues/${league}\n` +
        `  would back up admin map (${Object.keys(admin).join(", ")}) → ${backupPath}\n` +
        `  would write /leagues/${league}/_secrets/admin.password\n` +
        `  would delete admin.password from the public doc (keeping passwordless)`,
    );
    process.exit(0);
  }

  fs.writeFileSync(backupPath, JSON.stringify({ league, admin }, null, 2));
  console.log(`[move-admin-pw] backed up admin map → ${backupPath}`);

  // 1) Write the secret. 2) Only then scrub the public field.
  await db
    .doc(`leagues/${league}/_secrets/admin`)
    .set({ password }, { merge: true });
  await ref.set({ admin: { password: FieldValue.delete() } }, { merge: true });

  // Verify.
  const after = (await ref.get()).data()?.admin as Record<string, unknown>;
  const secret = (
    await db.doc(`leagues/${league}/_secrets/admin`).get()
  ).data()?.password;
  const ok = after?.password === undefined && secret === password;
  console.log(
    `[move-admin-pw] /leagues/${league}: ` +
      (ok
        ? "migrated ✓ (password now in _secrets/admin, public field removed)"
        : "VERIFY FAILED — check the backup and re-run"),
  );
  process.exit(ok ? 0 : 1);
})();
