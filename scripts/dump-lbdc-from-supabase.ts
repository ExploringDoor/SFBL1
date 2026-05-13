// scripts/dump-lbdc-from-supabase.ts — Phase 1 of the LBDC migration.
//
// Pulls every relevant table out of LBDC's Supabase Postgres and writes
// each to data/lbdc/raw/<table>.json. Read-only on the Supabase side,
// no Firestore writes. Run any time without side effects.
//
// Why a separate dump step (rather than read-and-write-to-Firestore in
// one shot): we want a frozen snapshot we can re-inspect, version, and
// build the Firestore transform against offline. The eventual
// `seed-lbdc-to-firestore.ts` script will read these JSON files, not
// Supabase directly — so the import path stays cheap and re-runnable
// after the cutover (when Supabase is gone).
//
// Required env (in .env.local):
//   SUPABASE_LBDC_URL=https://vhovzpajuyphjatjlodo.supabase.co
//   SUPABASE_LBDC_SERVICE_KEY=<service-role JWT — bypasses RLS>
//
// Usage:
//   npm run dump:lbdc
//   npm run dump:lbdc -- --table games           # one table
//   npm run dump:lbdc -- --tables games,seasons  # several
//   npm run dump:lbdc -- --dry-run               # don't write files
//
// Pagination: Supabase's REST endpoint defaults to 1000 rows per
// request. We loop with `?limit=1000&offset=N&order=id.asc` until a
// short page lands. Same pattern LBDC's own `sbFetchAll` uses (see
// App.jsx line 10411).

import * as fs from "node:fs";
import * as path from "node:path";

// ── env loader (matches scripts/seed.ts pattern) ────────────────────
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

const SUPABASE_URL = process.env.SUPABASE_LBDC_URL ?? "";
const SUPABASE_KEY = process.env.SUPABASE_LBDC_SERVICE_KEY ?? "";

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error(
    "[dump-lbdc] Missing SUPABASE_LBDC_URL or SUPABASE_LBDC_SERVICE_KEY in .env.local.",
  );
  process.exit(2);
}

// ── tables to dump ──────────────────────────────────────────────────
// Order matters only for readability — every table is independent.
// `idColumn` defaults to "id"; override where the table uses a
// composite or differently-named primary key.
//
// Authoritative source: PLATFORM_MIGRATION.md §1 in the LBDC repo
// (~/Desktop/Long-Beach-Men-s-Baseball/PLATFORM_MIGRATION.md).
// Singletons (lbdc_alert, lbdc_contact, etc.) live as a single row
// with id="main"; multi-row tables (news, gallery, etc.) keyed by
// their own ids. If any of these 404 we log it and skip rather than
// crash.
const TABLES: { name: string; idColumn?: string }[] = [
  // Multi-row read tables
  { name: "seasons" },
  { name: "games" },
  { name: "batting_lines" },
  // pitching_lines has NO hr column (PostgREST 400s if you select
  // it). SELECT * is fine — column just isn't there.
  { name: "pitching_lines" },
  { name: "availability" },
  { name: "news" },
  { name: "tournament_games" },
  { name: "lbdc_rosters" },
  { name: "lbdc_schedules" },
  { name: "lbdc_signups" },
  { name: "lbdc_gallery" },
  { name: "lbdc_live_state" },
  { name: "player_payments" },
  // Singleton config rows (each table is exactly one row, id="main")
  { name: "lbdc_alert" },
  { name: "lbdc_contact" },
  { name: "lbdc_divisions" },
  { name: "lbdc_fields" },
  { name: "lbdc_rules" },
  { name: "lbdc_sponsors" },
  { name: "lbdc_tournament_meta" },
  { name: "lbdc_page_content" },
];

// ── CLI args ────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  let tablesArg: string | null = null;
  let dryRun = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--table" || args[i] === "--tables") {
      tablesArg = args[++i] ?? null;
    } else if (args[i] === "--dry-run") {
      dryRun = true;
    }
  }
  return { tablesArg, dryRun };
}
const { tablesArg, dryRun } = parseArgs();

const filteredTables = tablesArg
  ? (() => {
      const want = new Set(tablesArg.split(",").map((s) => s.trim()));
      const matched = TABLES.filter((t) => want.has(t.name));
      const missing = [...want].filter(
        (w) => !TABLES.some((t) => t.name === w),
      );
      if (missing.length) {
        console.error(
          `[dump-lbdc] Unknown table(s): ${missing.join(", ")}. Known: ${TABLES.map((t) => t.name).join(", ")}`,
        );
        process.exit(2);
      }
      return matched;
    })()
  : TABLES;

// ── Supabase paginated fetch ────────────────────────────────────────
const PAGE = 1000;

interface PageResult {
  rows: Record<string, unknown>[];
  status: number;
}

async function fetchPage(
  table: string,
  offset: number,
  idColumn: string,
): Promise<PageResult> {
  const url = `${SUPABASE_URL}/rest/v1/${table}?limit=${PAGE}&offset=${offset}&order=${idColumn}.asc`;
  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_KEY,
      authorization: `Bearer ${SUPABASE_KEY}`,
      // Default representation includes the rows in the response body.
      "accept-profile": "public",
      prefer: "count=exact",
    },
  });
  if (res.status === 404) {
    return { rows: [], status: 404 };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `[dump-lbdc] ${table} offset=${offset}: ${res.status} ${res.statusText} — ${text.slice(0, 200)}`,
    );
  }
  const body = (await res.json()) as Record<string, unknown>[];
  return { rows: body, status: res.status };
}

async function dumpTable(table: string, idColumn: string): Promise<{
  rows: Record<string, unknown>[];
  exists: boolean;
}> {
  const rows: Record<string, unknown>[] = [];
  let offset = 0;
  // First page also doubles as an existence probe — 404 = table not
  // found (we skip without exploding).
  const first = await fetchPage(table, offset, idColumn);
  if (first.status === 404) {
    return { rows: [], exists: false };
  }
  rows.push(...first.rows);
  while (first.rows.length === PAGE) {
    offset += PAGE;
    const next = await fetchPage(table, offset, idColumn);
    rows.push(...next.rows);
    if (next.rows.length < PAGE) break;
  }
  return { rows, exists: true };
}

// ── main ────────────────────────────────────────────────────────────
async function main() {
  const outDir = path.resolve(process.cwd(), "data/lbdc/raw");
  if (!dryRun) fs.mkdirSync(outDir, { recursive: true });

  console.log(
    `[dump-lbdc] Supabase URL: ${SUPABASE_URL}\n[dump-lbdc] Service key: ${SUPABASE_KEY.slice(0, 8)}…${SUPABASE_KEY.length}c\n[dump-lbdc] Tables: ${filteredTables.length}\n[dump-lbdc] Mode: ${dryRun ? "DRY RUN" : "WRITE"} → ${outDir}\n`,
  );

  const summary: Array<{
    table: string;
    rows: number;
    bytes: number;
    status: "ok" | "missing" | "error";
    note?: string;
  }> = [];

  for (const t of filteredTables) {
    const idColumn = t.idColumn ?? "id";
    process.stdout.write(`  ${t.name.padEnd(28)} `);
    try {
      const { rows, exists } = await dumpTable(t.name, idColumn);
      if (!exists) {
        console.log("(no such table — skipped)");
        summary.push({
          table: t.name,
          rows: 0,
          bytes: 0,
          status: "missing",
        });
        continue;
      }
      const json = JSON.stringify(rows, null, 2);
      const bytes = Buffer.byteLength(json, "utf8");
      if (!dryRun) {
        fs.writeFileSync(path.join(outDir, `${t.name}.json`), json + "\n");
      }
      console.log(
        `${String(rows.length).padStart(5)} rows  ${String((bytes / 1024).toFixed(1)).padStart(7)} KB`,
      );
      summary.push({
        table: t.name,
        rows: rows.length,
        bytes,
        status: "ok",
      });
    } catch (err) {
      console.log(`ERROR`);
      console.error("    ", err instanceof Error ? err.message : err);
      summary.push({
        table: t.name,
        rows: 0,
        bytes: 0,
        status: "error",
        note: err instanceof Error ? err.message : String(err),
      });
    }
  }

  console.log("\n[dump-lbdc] Summary:");
  for (const s of summary) {
    const tag =
      s.status === "ok"
        ? "✓"
        : s.status === "missing"
          ? "·"
          : "✗";
    const sizeStr =
      s.status === "ok"
        ? `${s.rows} rows, ${(s.bytes / 1024).toFixed(1)} KB`
        : s.status === "missing"
          ? "table missing"
          : `error: ${s.note?.slice(0, 80) ?? ""}`;
    console.log(`  ${tag} ${s.table.padEnd(28)} ${sizeStr}`);
  }

  const okCount = summary.filter((s) => s.status === "ok").length;
  const missingCount = summary.filter((s) => s.status === "missing").length;
  const errCount = summary.filter((s) => s.status === "error").length;
  const totalRows = summary.reduce((acc, s) => acc + s.rows, 0);
  console.log(
    `\n[dump-lbdc] ${okCount} table(s) dumped, ${missingCount} skipped, ${errCount} error(s). Total rows: ${totalRows.toLocaleString()}.`,
  );

  if (!dryRun && okCount > 0) {
    const manifestPath = path.join(outDir, "_manifest.json");
    const manifest = {
      dumped_at: new Date().toISOString(),
      supabase_url: SUPABASE_URL,
      tables: summary,
    };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    console.log(`[dump-lbdc] Manifest: ${manifestPath}`);
  }

  if (errCount > 0) process.exit(1);
}

main().catch((err) => {
  console.error("[dump-lbdc] Fatal:", err);
  process.exit(1);
});
