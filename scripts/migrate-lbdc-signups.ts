// One-off migration: pull the 46 LBDC signups out of the raw Supabase
// dump and write them into /leagues/<slug>/form_submissions/
// player_registration/items/<id>, which is the path the admin Forms
// tab reads (FormSubmissionsViewer + /api/admin-form-submissions).
//
// The earlier transform-lbdc.ts dump wrote them to /leagues/<slug>/
// signups/<id> — that path predates the form_submissions standardization
// and isn't surfaced anywhere in the new admin. Adam just asked
// (2026-05-15) for the existing signups to actually show up in the
// admin so he can approve them.
//
// Run:
//   npx tsx scripts/migrate-lbdc-signups.ts --league lbdc-staging
//
// Safe to re-run — uses {merge: true} writes keyed by Supabase
// row id. Won't overwrite a doc that admin has already edited
// (e.g. status change) because we only set fields we own.

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
let dryRun = false;
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--league") league = args[++i] ?? null;
  else if (args[i] === "--dry-run") dryRun = true;
}
if (!league) {
  console.error("Usage: --league <slug> [--dry-run]");
  process.exit(2);
}

initializeApp({
  credential: cert(
    path.resolve(process.cwd(), process.env.FIREBASE_SERVICE_ACCOUNT_PATH!),
  ),
  projectId: process.env.FIREBASE_PROJECT_ID,
});
const db = getFirestore();

interface SupabaseSignup {
  id: number;
  created_at: string;
  name: string;
  team: string;
  email: string;
  phone: string;
  notes: string;
  reminders: boolean;
  scores: boolean;
  playoffs: boolean;
  rainouts: boolean;
}

function splitName(full: string): { first_name: string; last_name: string } {
  const parts = String(full ?? "").trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) return { first_name: "", last_name: "" };
  if (parts.length === 1) return { first_name: parts[0], last_name: "" };
  const first = parts[0]!;
  const last = parts.slice(1).join(" ");
  return { first_name: first, last_name: last };
}

(async () => {
  const raw = JSON.parse(
    fs.readFileSync(
      path.resolve(
        process.cwd(),
        "data/lbdc/raw/lbdc_signups.json",
      ),
      "utf8",
    ),
  ) as SupabaseSignup[];
  console.log(
    `[migrate-signups] ${raw.length} rows from data/lbdc/raw/lbdc_signups.json`,
  );

  let written = 0;
  for (const row of raw) {
    const id = String(row.id);
    const { first_name, last_name } = splitName(row.name);
    // Notification opt-ins from Supabase get rolled into the notes
    // field so admin can see which players want what — the new
    // platform doesn't have those columns yet.
    const optInNotes = [
      row.reminders ? "game reminders" : null,
      row.scores ? "score alerts" : null,
      row.playoffs ? "playoff updates" : null,
      row.rainouts ? "rainout notices" : null,
    ].filter(Boolean);
    const combinedNotes = [
      String(row.notes ?? "").trim(),
      optInNotes.length
        ? `Opted in: ${optInNotes.join(", ")}.`
        : null,
    ]
      .filter(Boolean)
      .join("\n\n");

    const payload = {
      submitted_at: row.created_at,
      created_at: row.created_at,
      first_name,
      last_name,
      name: row.name,
      email: String(row.email ?? "").toLowerCase().trim(),
      phone: String(row.phone ?? "").trim(),
      team_name: row.team,
      notes: combinedNotes,
      status: "pending" as const,
      source: "lbdc-supabase-migration",
      source_id: row.id,
    };

    const ref = db.doc(
      `leagues/${league}/form_submissions/player_registration/items/${id}`,
    );
    if (dryRun) {
      console.log(`[dry] ${id} ${payload.name} (${payload.team_name})`);
    } else {
      await ref.set(payload, { merge: true });
    }
    written++;
  }

  console.log(
    `[migrate-signups] ${dryRun ? "DRY" : "WROTE"} ${written} signups -> /leagues/${league}/form_submissions/player_registration/items/`,
  );
  process.exit(0);
})();
