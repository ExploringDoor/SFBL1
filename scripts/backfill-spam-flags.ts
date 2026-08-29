// One-time backfill: mark existing bot registrations in prod so they
// drop into the Admin "🚫 Spam" bucket, matching what the live filter
// now does for new submissions.
//
// Safe by design:
//   - Reads EVERY form_submissions item and writes a full JSON backup
//     before touching anything.
//   - Dry-run by default: prints what it WOULD flag and exits. Pass
//     --apply to actually write.
//   - Only ever SETS spam:true on docs the heuristic flags that aren't
//     already marked. Never clears a flag, never deletes, never edits
//     any other field. Idempotent.
//
// Usage:
//   tsx scripts/backfill-spam-flags.ts            # dry run (default)
//   tsx scripts/backfill-spam-flags.ts --apply    # write the flags

import path from "path";
import fs from "fs";
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { looksLikeSpam } from "../lib/spam";

const LEAGUE_ID = "sfbl";
const APPLY = process.argv.includes("--apply");

const SA_PATH = path.resolve(
  process.cwd(),
  "secrets/sfbl-acf51-service-account.json",
);
initializeApp({ credential: cert(SA_PATH), projectId: "sfbl-acf51" });
const db = getFirestore();

function short(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

async function main() {
  console.log(
    `\n=== Spam backfill for leagues/${LEAGUE_ID} — ${APPLY ? "APPLY (writing)" : "DRY RUN (no writes)"} ===\n`,
  );

  // Discover the kind subcollections actually present.
  const kindsRoot = db.collection(`leagues/${LEAGUE_ID}/form_submissions`);
  const kindDocs = await kindsRoot.listDocuments();
  const kinds = kindDocs.map((d) => d.id);
  console.log(`Kinds found: ${kinds.join(", ") || "(none)"}\n`);

  const backup: Record<string, Record<string, unknown>[]> = {};
  const toFlag: { kind: string; id: string; name: string }[] = [];
  let total = 0;
  let alreadyFlagged = 0;

  for (const kind of kinds) {
    const snap = await kindsRoot.doc(kind).collection("items").get();
    backup[kind] = [];
    for (const doc of snap.docs) {
      const data = doc.data();
      backup[kind].push({ id: doc.id, ...data });
      total++;

      if (data.spam === true) {
        alreadyFlagged++;
        continue;
      }
      if (looksLikeSpam(data)) {
        const name =
          [short(data.first_name), short(data.last_name)]
            .filter(Boolean)
            .join(" ") ||
          [short(data.manager_first_name), short(data.manager_last_name)]
            .filter(Boolean)
            .join(" ") ||
          short(data.team_name) ||
          "(no name)";
        toFlag.push({ kind, id: doc.id, name });
      }
    }
  }

  // Full backup BEFORE any write, even on a dry run.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupFile = path.resolve(
    process.cwd(),
    `_backup_form_submissions_${LEAGUE_ID}_${stamp}.json`,
  );
  fs.writeFileSync(backupFile, JSON.stringify(backup, null, 2));
  console.log(`Backed up ${total} submissions → ${backupFile}\n`);

  console.log(`Already flagged spam: ${alreadyFlagged}`);
  console.log(`Newly matching the heuristic: ${toFlag.length}\n`);
  for (const f of toFlag) {
    console.log(`  [${f.kind}] ${f.id}  "${f.name}"`);
  }

  if (!APPLY) {
    console.log(
      `\nDry run — nothing written. Re-run with --apply to flag the ${toFlag.length} above.`,
    );
    return;
  }

  if (toFlag.length === 0) {
    console.log("\nNothing to write.");
    return;
  }

  let n = 0;
  for (const f of toFlag) {
    await kindsRoot
      .doc(f.kind)
      .collection("items")
      .doc(f.id)
      .set({ spam: true }, { merge: true });
    n++;
  }
  console.log(`\nDone — flagged ${n} submissions as spam.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
