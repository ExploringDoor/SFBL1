// scripts/seed-lbdc-to-firestore.ts — Phase 2 of the LBDC migration.
//
// Reads the transformed Firestore-shape JSON from
// data/lbdc/firestore/ and writes it into Firestore under
// /leagues/<slug>/<collection>/<docId>. Idempotent (setDoc with
// merge: true). Re-run after a fresh dump+transform to pick up
// updates.
//
// Usage:
//   npm run seed:lbdc -- --league lbdc-staging              (preview)
//   npm run seed:lbdc -- --league lbdc-staging --dry-run    (no writes)
//   npm run seed:lbdc -- --league lbdc-staging --collection games
//   npm run seed:lbdc -- --league lbdc            (real production write)
//
// The `--league` slug is required (no default) — forces explicit
// scoping so we don't accidentally clobber SFBL. Default flow uses
// `lbdc-staging` so an early run can be inspected via Firestore
// console without exposing it on a live domain.
//
// What gets written:
//   /leagues/<slug>                 — top-level tenant doc (skipped
//                                     by default; pass --provision
//                                     to write it)
//   /leagues/<slug>/seasons/<id>
//   /leagues/<slug>/teams/<slug>
//   /leagues/<slug>/players/<id>
//   /leagues/<slug>/games/<id>
//   /leagues/<slug>/tournament_games/<id>
//   /leagues/<slug>/box_scores/<gameId>
//   /leagues/<slug>/news/<id>
//   /leagues/<slug>/signups/<id>    (form_submissions/player_registration eventually — see TODO)
//   /leagues/<slug>/payments/<id>
//   /leagues/<slug>/availability/<id>
//   /leagues/<slug>/photos/<id>
//   /leagues/<slug>/site_config/<key>  — singletons (alert, contact, etc.)
//
// Service account env required (matches scripts/seed.ts pattern):
//   FIREBASE_SERVICE_ACCOUNT_PATH=secrets/sfbl-acf51-service-account.json
//   FIREBASE_PROJECT_ID=sfbl-acf51
// OR for emulator:
//   FIRESTORE_EMULATOR_HOST=localhost:8080 npm run seed:lbdc -- --league lbdc

import * as fs from "node:fs";
import * as path from "node:path";

// env loader (matches scripts/seed.ts)
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
import { getFirestore, type Firestore } from "firebase-admin/firestore";

// ── CLI args ────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  let league: string | null = null;
  let collectionFilter: string | null = null;
  let dryRun = false;
  let provision = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--league") league = args[++i] ?? null;
    else if (args[i] === "--collection") collectionFilter = args[++i] ?? null;
    else if (args[i] === "--dry-run") dryRun = true;
    else if (args[i] === "--provision") provision = true;
  }
  return { league, collectionFilter, dryRun, provision };
}

const { league, collectionFilter, dryRun, provision } = parseArgs();

if (!league) {
  console.error(
    "[seed-lbdc] --league <slug> required. Suggested: --league lbdc-staging for first run, --league lbdc for production.",
  );
  process.exit(2);
}
if (!/^[a-z][a-z0-9-]*$/.test(league)) {
  console.error(
    `[seed-lbdc] Invalid league slug "${league}". Must be lowercase alphanumeric + hyphens.`,
  );
  process.exit(2);
}

const TRANSFORM_DIR = path.resolve(process.cwd(), "data/lbdc/firestore");
if (!fs.existsSync(TRANSFORM_DIR)) {
  console.error(
    `[seed-lbdc] No transformed data at ${TRANSFORM_DIR}. Run \`npm run dump:lbdc\` then \`npx tsx scripts/transform-lbdc.ts\` first.`,
  );
  process.exit(2);
}

// ── Firebase Admin init ─────────────────────────────────────────────
const useEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const projectId = useEmulator
  ? process.env.GCLOUD_PROJECT ||
    process.env.FIREBASE_PROJECT_ID ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
    "demo-lbdc"
  : process.env.FIREBASE_PROJECT_ID ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

if (!projectId) {
  console.error("[seed-lbdc] No project ID. Set FIREBASE_PROJECT_ID.");
  process.exit(2);
}

if (!dryRun) {
  if (useEmulator) {
    initializeApp({ projectId });
    console.log(
      `[seed-lbdc] Emulator: ${process.env.FIRESTORE_EMULATOR_HOST}, project: ${projectId}`,
    );
  } else {
    const saPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
    if (!saPath) {
      console.error(
        "[seed-lbdc] FIREBASE_SERVICE_ACCOUNT_PATH not set. See DEPLOY.md.",
      );
      process.exit(2);
    }
    const resolved = path.resolve(process.cwd(), saPath);
    if (!fs.existsSync(resolved)) {
      console.error(`[seed-lbdc] Service account not found at ${resolved}`);
      process.exit(2);
    }
    initializeApp({ credential: cert(resolved), projectId });
    console.log(
      `[seed-lbdc] Service account: ${saPath}, project: ${projectId}`,
    );
  }
}

// ── collections to seed ─────────────────────────────────────────────
// Order chosen so referenced docs exist before referrers — e.g.
// teams before players, games before box_scores. The seeder
// tolerates out-of-order reads because Firestore doesn't enforce
// FKs, but this is friendlier for diff inspection.
const COLLECTION_ORDER = [
  "seasons",
  "teams",
  "players",
  "games",
  "tournament_games",
  "box_scores",
  "news",
  "signups",
  "payments",
  "availability",
  "photos",
];

// Singletons: live under /leagues/<slug>/site_config/<key>.
const SINGLETON_KEYS = [
  "alert",
  "contact",
  "divisions",
  "fields",
  "rules",
  "sponsors",
  "tournament_meta",
  "page_content",
  "schedules",
];

// ── seeder ──────────────────────────────────────────────────────────

async function seedCollection(
  db: Firestore | null,
  collection: string,
): Promise<{ wrote: number; bytes: number }> {
  const dir = path.join(TRANSFORM_DIR, collection);
  if (!fs.existsSync(dir)) {
    return { wrote: 0, bytes: 0 };
  }
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort();
  let wrote = 0;
  let bytes = 0;
  // Firestore Admin SDK batched writes top out at 500 ops per batch.
  // Stream in chunks of 400 to leave headroom.
  const BATCH = 400;
  for (let i = 0; i < files.length; i += BATCH) {
    const chunk = files.slice(i, i + BATCH);
    if (!dryRun && db) {
      const batch = db.batch();
      for (const f of chunk) {
        const docId = f.replace(/\.json$/, "");
        const data = JSON.parse(
          fs.readFileSync(path.join(dir, f), "utf8"),
        );
        const ref = db
          .collection(`leagues/${league}/${collection}`)
          .doc(docId);
        batch.set(ref, data, { merge: true });
      }
      await batch.commit();
    }
    for (const f of chunk) {
      bytes += fs.statSync(path.join(dir, f)).size;
    }
    wrote += chunk.length;
    if (files.length > BATCH) {
      process.stdout.write(
        `\r    ${collection.padEnd(20)} ${wrote}/${files.length} docs…`,
      );
    }
  }
  if (files.length > BATCH) process.stdout.write("\n");
  return { wrote, bytes };
}

async function seedSingletons(
  db: Firestore | null,
): Promise<{ wrote: number; bytes: number }> {
  const dir = path.join(TRANSFORM_DIR, "_config");
  if (!fs.existsSync(dir)) return { wrote: 0, bytes: 0 };
  let wrote = 0;
  let bytes = 0;
  for (const key of SINGLETON_KEYS) {
    const file = path.join(dir, `${key}.json`);
    if (!fs.existsSync(file)) continue;
    const raw = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw);
    // Skip null / empty singletons — no point creating empty docs.
    if (parsed == null) continue;
    bytes += Buffer.byteLength(raw, "utf8");
    if (!dryRun && db) {
      const ref = db
        .collection(`leagues/${league}/site_config`)
        .doc(key);
      // Singletons land on a single doc. Wrap arrays/scalars in {data}
      // so Firestore can store them (top-level can't be an array).
      const payload =
        Array.isArray(parsed) || typeof parsed !== "object"
          ? { data: parsed }
          : parsed;
      await ref.set(payload, { merge: true });
    }
    wrote++;
  }
  return { wrote, bytes };
}

async function seedTenantDoc(db: Firestore | null): Promise<void> {
  // Only when --provision is passed; creates/merges the top-level
  // /leagues/<slug> tenant doc. Minimal config — name + sport +
  // billing placeholder. Adam can fill in theme + flags later via
  // the admin branding tab.
  const ref = db ? db.doc(`leagues/${league}`) : null;
  const data = {
    slug: league,
    name: "Long Beach Diamond Classic",
    abbrev: "LBDC",
    sport: "baseball",
    innings: 9,
    ruleset: "hardball",
    linescore_innings: 9,
    stat_columns: ["AB", "R", "H", "2B", "3B", "HR", "RBI", "BB", "SO", "SB"],
    pitching: { enabled: true, auto_innings_pitched: true, record_pitches: false },
    rules_flags: { dropped_third_strike: true, balks: true, infield_fly: true },
    theme: {
      primary: "#002d6e", // LBDC navy
      accent: "#FFD700",   // LBDC gold
      logo_url: null,
    },
    billing: { status: "active", paid_through: null, notes: "Migrated from Supabase" },
    standings: {
      // LBDC doesn't use a points system — standings show W/L/T
      // sorted by PCT (with run-differential as the tiebreaker per
      // their conventions). Per Adam, 2026-05-13.
      scoring: "pct",
      tiebreaker: "rd",
    },
    // Per-tenant nav customization. LBDC doesn't run a /news page.
    nav: { hide: ["News"] },
    migrated_at: new Date().toISOString(),
    migrated_from: "supabase://vhovzpajuyphjatjlodo",
  };
  if (!dryRun && ref) {
    await ref.set(data, { merge: true });
  }
  console.log(
    `[seed-lbdc] tenant doc /leagues/${league} (${dryRun ? "DRY" : "WROTE"})`,
  );
}

async function main() {
  const db = dryRun ? null : getFirestore();

  console.log(
    `\n[seed-lbdc] Target: /leagues/${league}/...  mode: ${dryRun ? "DRY RUN (no writes)" : "WRITE"}\n`,
  );

  if (provision) {
    await seedTenantDoc(db);
  }

  const collectionsToSeed = collectionFilter
    ? COLLECTION_ORDER.filter((c) => c === collectionFilter)
    : COLLECTION_ORDER;

  if (collectionFilter && collectionsToSeed.length === 0) {
    console.error(
      `[seed-lbdc] Unknown --collection "${collectionFilter}". Known: ${COLLECTION_ORDER.join(", ")}, _config`,
    );
    process.exit(2);
  }

  const summary: Array<{ collection: string; docs: number; kb: number }> = [];
  for (const c of collectionsToSeed) {
    process.stdout.write(`  ${c.padEnd(20)} `);
    const { wrote, bytes } = await seedCollection(db, c);
    console.log(`${String(wrote).padStart(5)} docs  ${(bytes / 1024).toFixed(1).padStart(7)} KB`);
    summary.push({ collection: c, docs: wrote, kb: bytes / 1024 });
  }

  if (!collectionFilter || collectionFilter === "_config") {
    process.stdout.write(`  ${"site_config".padEnd(20)} `);
    const { wrote, bytes } = await seedSingletons(db);
    console.log(`${String(wrote).padStart(5)} docs  ${(bytes / 1024).toFixed(1).padStart(7)} KB`);
    summary.push({ collection: "site_config", docs: wrote, kb: bytes / 1024 });
  }

  const totalDocs = summary.reduce((acc, s) => acc + s.docs, 0);
  const totalKb = summary.reduce((acc, s) => acc + s.kb, 0);
  console.log(
    `\n[seed-lbdc] ${dryRun ? "DRY RUN" : "Wrote"} ${totalDocs.toLocaleString()} docs (${totalKb.toFixed(1)} KB) to /leagues/${league}/`,
  );

  if (dryRun) {
    console.log(
      `\n[seed-lbdc] Re-run without --dry-run to actually write.`,
    );
  }
}

main().catch((err) => {
  console.error("[seed-lbdc] Fatal:", err);
  process.exit(1);
});
