// Seed a tenant's venue list from a JSON file into
// leagues/{slug}/site_config/fields — the doc the public /fields page and the
// admin Fields tab read.
//
// Generic replacement for the one-off seed-lcybl-fields / seed-windmill-fields
// scripts, so the next tenant needs a data file and not a script.
//
// Usage:
//   npm run seed:fields -- --league etbl --file data/etbl/fields.json
//   npm run seed:fields:emulator -- --league etbl --file data/etbl/fields.json
//
// The file is an array of { name, address, mapsUrl?, appleMapsUrl?, team?,
// location?, notes? } (or an object with a `fields` array). Sorted by name on
// the way in, the same way /api/admin-fields sorts on save. Note that an admin
// re-save through the Fields tab keeps only the fields that API whitelists —
// `notes` is dropped then — so treat notes as a placeholder nicety.
//
// Modes: emulator when FIRESTORE_EMULATOR_HOST is set; otherwise the service
// account named by FIREBASE_SERVICE_ACCOUNT_PATH / _JSON (lib/firebase-admin).

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
    const t = (v ?? "").trim();
    const val =
      (t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))
        ? t.slice(1, -1)
        : t;
    if (!process.env[k!]) process.env[k!] = val;
  }
})();

import { getAdminDb } from "../lib/firebase-admin";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

const league = arg("--league");
const file = arg("--file");
if (!league || !file || !/^[a-z0-9][a-z0-9-]*$/.test(league)) {
  console.error("Usage: npm run seed:fields -- --league <slug> --file <fields.json>");
  process.exit(1);
}

const resolved = path.resolve(process.cwd(), file);
if (!fs.existsSync(resolved)) {
  console.error(`[seed-fields] file not found: ${resolved}`);
  process.exit(1);
}

interface FieldRow {
  name: string;
  address: string;
  [k: string]: unknown;
}

const raw = JSON.parse(fs.readFileSync(resolved, "utf8")) as unknown;
const list = (
  Array.isArray(raw) ? raw : ((raw as { fields?: unknown }).fields ?? [])
) as FieldRow[];
const fields = list
  .filter((f) => f && typeof f.name === "string" && f.name.trim())
  .map((f) => ({ ...f, name: f.name.trim(), address: String(f.address ?? "").trim() }))
  .sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }),
  );
if (fields.length === 0) {
  console.error("[seed-fields] no fields with a name in that file");
  process.exit(1);
}

(async () => {
  const db = getAdminDb();
  const leagueSnap = await db.doc(`leagues/${league}`).get();
  if (!leagueSnap.exists) {
    console.error(`[seed-fields] leagues/${league} does not exist — provision the tenant first.`);
    process.exit(1);
  }
  await db
    .doc(`leagues/${league}/site_config/fields`)
    .set({ data: fields, updated_at: new Date().toISOString() }, { merge: true });
  console.log(`[seed-fields] wrote ${fields.length} venue(s) to leagues/${league}/site_config/fields`);
  for (const f of fields) console.log(`  ${f.name}${f.address ? ` — ${f.address}` : ""}`);
  process.exit(0);
})().catch((e) => {
  console.error("[seed-fields] failed:", e);
  process.exit(1);
});
