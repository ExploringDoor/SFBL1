// Migrates PII (email, phone) off public /players/{id} docs into
// admin-only /players/{id}/_private/contact subdocs.
//
// Why: rules at /players/{id} are public-read so the website can
// list rosters without auth. We were storing email + phone there
// too — exposing them. The /_private/{doc} pattern (already used
// by /teams) restricts read+write to admin + the player themselves.
//
// Idempotent: re-running on already-migrated data is a no-op (the
// public doc has no email/phone to move).
//
// Usage:  GCLOUD_PROJECT=… FIRESTORE_EMULATOR_HOST=… tsx scripts/migrate-pii-to-private.ts <leagueId>

import { getAdminDb } from "../lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

async function main() {
  const leagueId = process.argv[2];
  if (!leagueId) {
    console.error("Usage: tsx scripts/migrate-pii-to-private.ts <leagueId>");
    process.exit(1);
  }
  const db = getAdminDb();
  const snap = await db.collection(`leagues/${leagueId}/players`).get();
  console.log(`Scanning ${snap.size} players in /leagues/${leagueId}/players`);

  let moved = 0;
  let skipped = 0;
  let errors = 0;

  for (const doc of snap.docs) {
    const data = doc.data();
    const email =
      typeof data.email === "string" && data.email ? data.email : "";
    const phone =
      typeof data.phone === "string" && data.phone ? data.phone : "";
    if (!email && !phone) {
      skipped++;
      continue;
    }

    try {
      // Write contact subdoc — merge so we don't clobber an existing
      // one (e.g. partial migration that ran before).
      await db
        .doc(`leagues/${leagueId}/players/${doc.id}/_private/contact`)
        .set(
          {
            ...(email ? { email: email.toLowerCase() } : {}),
            ...(phone ? { phone } : {}),
            migrated_from_public_doc_at: new Date().toISOString(),
          },
          { merge: true },
        );

      // Delete the public-doc fields. FieldValue.delete() removes
      // the keys without touching anything else on the doc.
      const deletes: Record<string, FirebaseFirestore.FieldValue> = {};
      if (email) deletes.email = FieldValue.delete();
      if (phone) deletes.phone = FieldValue.delete();
      await doc.ref.set(deletes, { merge: true });

      moved++;
      if (moved % 25 === 0) console.log(`  migrated ${moved}…`);
    } catch (e) {
      errors++;
      console.error(
        `[error] ${doc.id}: ${e instanceof Error ? e.message : "unknown"}`,
      );
    }
  }

  console.log(`Done. moved=${moved} skipped=${skipped} errors=${errors}`);
}

main().then(() => process.exit(0));
