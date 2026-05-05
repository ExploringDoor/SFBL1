// Provision a new tenant — verbatim "cookie cutter" entry point.
//
// Usage:
//   npm run provision -- --config path/to/config.json
//   npm run provision -- --config path/to/config.json --dry-run
//   npm run provision:emulator -- --config path/to/config.json
//
// Config JSON shape:
// {
//   "league": { ...LeagueConfig (see lib/types.ts) },
//   "teams_csv":    "./data/sfbl-teams.csv",     // optional
//   "players_csv":  "./data/sfbl-players.csv",   // optional
//   "schedule_csv": "./data/sfbl-schedule.csv",  // optional
//   "admins":       ["adam@example.com", ...]    // optional — emails
//                                                 // to grant admin claim
// }
//
// CSV formats:
//   teams.csv:
//     id,name,abbrev,division,color,logo_url
//
//   players.csv:
//     team_id,name,jersey,position,email,phone
//
//   schedule.csv:
//     id,date,time,field,away_team_id,home_team_id,week,division
//     (date is ISO yyyy-mm-dd, time is 24h "HH:MM"; we combine into
//      ISO datetime with the local TZ unless the date is already
//      datetime form)
//
// All writes are idempotent (setDoc with merge). Re-running with the
// same config updates rather than duplicates. --dry-run validates +
// shows a preview without writing.

import * as fs from "node:fs";
import * as path from "node:path";

// Minimal env loader (matches scripts/seed.ts pattern).
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
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

import { cert, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import type { LeagueConfig } from "../lib/types";

// ── CLI args ────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  let configPath: string | null = null;
  let dryRun = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--config") configPath = args[++i] ?? null;
    else if (args[i] === "--dry-run") dryRun = true;
  }
  return { configPath, dryRun };
}

const { configPath, dryRun } = parseArgs();
if (!configPath) {
  console.error(
    "[provision] Missing --config <path>. Example:\n  npm run provision -- --config ./data/sfbl.json",
  );
  process.exit(1);
}
const resolvedConfig = path.resolve(process.cwd(), configPath);
if (!fs.existsSync(resolvedConfig)) {
  console.error(`[provision] Config not found: ${resolvedConfig}`);
  process.exit(1);
}

interface Provision {
  league: LeagueConfig;
  teams_csv?: string;
  players_csv?: string;
  schedule_csv?: string;
  admins?: string[];
}

const provision = JSON.parse(
  fs.readFileSync(resolvedConfig, "utf8"),
) as Provision;

if (!provision.league?.slug) {
  console.error("[provision] config.league.slug is required");
  process.exit(1);
}
if (!/^[a-z0-9][a-z0-9-]*$/.test(provision.league.slug)) {
  console.error(
    `[provision] config.league.slug "${provision.league.slug}" — must be lowercase alphanumeric (with -)`,
  );
  process.exit(1);
}

// ── Firebase init ───────────────────────────────────────────────────
const useEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const projectId = useEmulator
  ? process.env.GCLOUD_PROJECT ||
    process.env.FIREBASE_PROJECT_ID ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
    "demo-provision"
  : process.env.FIREBASE_PROJECT_ID ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

if (!projectId) {
  console.error("[provision] No project ID resolved");
  process.exit(1);
}

if (useEmulator) {
  initializeApp({ projectId });
  console.log(
    `[provision] Emulator mode: ${process.env.FIRESTORE_EMULATOR_HOST} (project: ${projectId})`,
  );
} else {
  // Accept either inline JSON (Vercel-style) or a path (local-dev style).
  const saJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const saPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  let credential;
  if (saJson) {
    try {
      credential = cert(JSON.parse(saJson));
    } catch (e) {
      console.error(
        `[provision] FIREBASE_SERVICE_ACCOUNT_JSON didn't parse: ${e instanceof Error ? e.message : e}`,
      );
      process.exit(1);
    }
  } else if (saPath) {
    const resolved = path.resolve(process.cwd(), saPath);
    if (!fs.existsSync(resolved)) {
      console.error(`[provision] Service account not found: ${resolved}`);
      process.exit(1);
    }
    credential = cert(resolved);
  } else {
    console.error(
      "[provision] No service account configured. Set FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT_PATH.",
    );
    process.exit(1);
  }
  initializeApp({ credential, projectId });
  console.log(
    `[provision] PROD mode: project ${projectId} via service account`,
  );
}

const db = getFirestore();
const auth = getAuth();
const leagueId = provision.league.slug;

// ── CSV parsing ─────────────────────────────────────────────────────
// Tiny CSV parser — handles quoted fields with commas + escaped quotes.
// Sufficient for tenant-onboarding CSVs; not a full RFC 4180 impl.
function parseCsv(rawInput: string): string[][] {
  // Strip UTF-8 BOM if present — Excel CSV exports include one by
  // default; without this strip, the first header column shows up as
  // "﻿id" instead of "id" and every row drops that field.
  const input =
    rawInput.charCodeAt(0) === 0xfeff ? rawInput.slice(1) : rawInput;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let i = 0;
  while (i < input.length) {
    const c = input[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      cell += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      row.push(cell);
      cell = "";
      i++;
      continue;
    }
    if (c === "\n") {
      row.push(cell);
      // Strip trailing \r on Windows line endings.
      if (row[0] === "" && row.length === 1) {
        row = [];
        cell = "";
        i++;
        continue;
      }
      rows.push(row);
      row = [];
      cell = "";
      i++;
      continue;
    }
    if (c === "\r") {
      i++;
      continue;
    }
    cell += c;
    i++;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 0 && r.some((v) => v.trim() !== ""));
}

function csvToObjects(input: string): Record<string, string>[] {
  const rows = parseCsv(input);
  if (rows.length === 0) return [];
  const headers = rows[0]!.map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      obj[h] = (r[idx] ?? "").trim();
    });
    return obj;
  });
}

// ── Validation helpers ──────────────────────────────────────────────
function requireFields(
  obj: Record<string, string>,
  fields: string[],
  label: string,
  rowIdx: number,
): string[] {
  const missing: string[] = [];
  for (const f of fields) {
    if (!obj[f] || !obj[f]!.trim()) missing.push(f);
  }
  if (missing.length) {
    return [
      `[${label} row ${rowIdx + 2}] missing required field(s): ${missing.join(", ")}`,
    ];
  }
  return [];
}

const isoSlug = /^[a-z0-9][a-z0-9_-]*$/;

// ── Stage builders ──────────────────────────────────────────────────
interface StageResult {
  errors: string[];
  writes: { path: string; data: Record<string, unknown> }[];
}

function loadCsvIfPresent(
  filename: string | undefined,
): Record<string, string>[] | null {
  if (!filename) return null;
  const resolved = path.resolve(path.dirname(resolvedConfig), filename);
  if (!fs.existsSync(resolved)) {
    console.error(`[provision] CSV not found: ${resolved}`);
    process.exit(1);
  }
  return csvToObjects(fs.readFileSync(resolved, "utf8"));
}

function stageTeams(): StageResult {
  const rows = loadCsvIfPresent(provision.teams_csv);
  if (!rows) return { errors: [], writes: [] };
  const errors: string[] = [];
  const writes: StageResult["writes"] = [];
  // Track team IDs we've already staged so duplicate rows in the CSV
  // don't silently overwrite each other on commit.
  const seenIds = new Set<string>();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    errors.push(...requireFields(r, ["id", "name"], "teams", i));
    if (r.id && !isoSlug.test(r.id)) {
      errors.push(
        `[teams row ${i + 2}] id "${r.id}" must be lowercase alphanumeric (with - or _)`,
      );
    }
    if (r.id && seenIds.has(r.id)) {
      errors.push(
        `[teams row ${i + 2}] duplicate id "${r.id}" — appeared earlier in the same CSV`,
      );
    }
    if (errors.length && errors[errors.length - 1]!.includes(`row ${i + 2}`)) {
      continue;
    }
    if (r.id) seenIds.add(r.id);
    writes.push({
      path: `leagues/${leagueId}/teams/${r.id}`,
      data: {
        name: r.name,
        ...(r.abbrev ? { abbrev: r.abbrev } : {}),
        ...(r.division ? { division: r.division } : {}),
        ...(r.color ? { color: r.color } : {}),
        ...(r.logo_url ? { logo_url: r.logo_url } : {}),
        active: true,
        updated_at: new Date().toISOString(),
      },
    });
  }
  return { errors, writes };
}

function stagePlayers(): StageResult {
  const rows = loadCsvIfPresent(provision.players_csv);
  if (!rows) return { errors: [], writes: [] };
  const errors: string[] = [];
  const writes: StageResult["writes"] = [];
  // Detect collisions on computed player IDs. Two players named the
  // same on the same team would both slug to the same id and the
  // second would silently overwrite the first — surface this as an
  // error so the commissioner disambiguates (e.g. "John Smith Jr").
  const seenIds = new Set<string>();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    errors.push(...requireFields(r, ["team_id", "name"], "players", i));
    // Player doc id: prefer caller-supplied "id"; else generate from
    // team_id + slugified name. Idempotency relies on stable IDs, so
    // if the CSV omits id, the same name on the same team always
    // resolves to the same doc.
    const playerName = String(r.name ?? "");
    const teamId = String(r.team_id ?? "");
    const id =
      r.id ||
      `${teamId}_${playerName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_|_$/g, "")}`;
    if (!isoSlug.test(id)) {
      errors.push(`[players row ${i + 2}] computed id "${id}" is invalid`);
      continue;
    }
    if (seenIds.has(id)) {
      errors.push(
        `[players row ${i + 2}] duplicate computed id "${id}" — two players with the same name on team "${teamId}". Disambiguate names (e.g. "John Smith Jr") or supply explicit ids.`,
      );
      continue;
    }
    const jersey = r.jersey ? Number(r.jersey) : null;
    if (r.jersey && !Number.isFinite(jersey)) {
      errors.push(`[players row ${i + 2}] jersey "${r.jersey}" not a number`);
      continue;
    }
    seenIds.add(id);
    writes.push({
      path: `leagues/${leagueId}/players/${id}`,
      data: {
        team_id: r.team_id,
        name: r.name,
        ...(jersey != null ? { jersey } : {}),
        ...(r.position ? { position: r.position } : {}),
        ...(r.email ? { email: r.email.toLowerCase() } : {}),
        ...(r.phone ? { phone: r.phone } : {}),
        active: true,
        updated_at: new Date().toISOString(),
      },
    });
  }
  return { errors, writes };
}

function stageSchedule(): StageResult {
  const rows = loadCsvIfPresent(provision.schedule_csv);
  if (!rows) return { errors: [], writes: [] };
  const errors: string[] = [];
  const writes: StageResult["writes"] = [];
  // Game IDs must be unique within a CSV — duplicates would overwrite
  // (idempotent for re-imports, but a typo within one file silently
  // drops a game).
  const seenIds = new Set<string>();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    errors.push(
      ...requireFields(
        r,
        ["id", "date", "away_team_id", "home_team_id"],
        "schedule",
        i,
      ),
    );
    if (r.id && !isoSlug.test(r.id)) {
      errors.push(`[schedule row ${i + 2}] id "${r.id}" invalid`);
      continue;
    }
    if (r.id && seenIds.has(r.id)) {
      errors.push(
        `[schedule row ${i + 2}] duplicate id "${r.id}" — appeared earlier in the same CSV`,
      );
      continue;
    }
    if (r.id) seenIds.add(r.id);
    if (r.away_team_id && r.away_team_id === r.home_team_id) {
      errors.push(
        `[schedule row ${i + 2}] away_team_id and home_team_id are the same ("${r.away_team_id}") — a team can't play itself`,
      );
      continue;
    }
    // Combine date + time into an ISO datetime if `date` looks like a
    // date-only and `time` is present. If `date` already includes T,
    // treat it as the full datetime.
    let dateIso: string | null = null;
    const dateRaw = String(r.date ?? "");
    const timeRaw = String(r.time ?? "");
    if (/T\d/.test(dateRaw)) {
      const d = new Date(dateRaw);
      if (!Number.isNaN(d.getTime())) dateIso = d.toISOString();
    } else if (dateRaw) {
      const t = /^\d{1,2}:\d{2}$/.test(timeRaw) ? timeRaw : "00:00";
      const d = new Date(`${dateRaw}T${t}`);
      if (!Number.isNaN(d.getTime())) dateIso = d.toISOString();
    }
    if (!dateIso) {
      errors.push(
        `[schedule row ${i + 2}] couldn't parse date="${r.date}" time="${r.time ?? ""}"`,
      );
      continue;
    }
    const week = r.week ? Number(r.week) : null;
    if (r.week && !Number.isFinite(week)) {
      errors.push(`[schedule row ${i + 2}] week "${r.week}" not a number`);
      continue;
    }
    writes.push({
      path: `leagues/${leagueId}/games/${r.id}`,
      data: {
        date: dateIso,
        away_team_id: r.away_team_id,
        home_team_id: r.home_team_id,
        ...(r.field ? { field: r.field } : {}),
        ...(week != null ? { week } : {}),
        ...(r.division ? { division: r.division } : {}),
        status: "scheduled",
        away_score: 0,
        home_score: 0,
        updated_at: new Date().toISOString(),
      },
    });
  }
  return { errors, writes };
}

// ── Run ─────────────────────────────────────────────────────────────
async function grantAdminClaims(emails: string[]) {
  for (const email of emails) {
    try {
      const user = await auth.getUserByEmail(email);
      const existing = (user.customClaims ?? {}) as Record<string, unknown>;
      const leaguesClaim =
        (existing.leagues as Record<string, string> | undefined) ?? {};
      if (leaguesClaim[leagueId] === "admin") {
        console.log(`[provision] ${email} already admin of ${leagueId}`);
        continue;
      }
      const next = { ...existing, leagues: { ...leaguesClaim, [leagueId]: "admin" } };
      await auth.setCustomUserClaims(user.uid, next);
      console.log(`[provision] Granted admin:${leagueId} to ${email}`);
    } catch (e) {
      console.warn(
        `[provision] Couldn't grant admin to ${email}: ${
          e instanceof Error ? e.message : e
        }`,
      );
      console.warn(
        `[provision]   (User must sign in once to create their auth account first.)`,
      );
    }
  }
}

async function run() {
  console.log(`[provision] League: ${leagueId} (${provision.league.name})`);

  // Stage everything first so we can validate before writing.
  const stages: { label: string; result: StageResult }[] = [
    {
      label: "league config",
      result: {
        errors: [],
        writes: [
          {
            path: `leagues/${leagueId}`,
            data: {
              ...provision.league,
              updated_at: new Date().toISOString(),
            },
          },
        ],
      },
    },
    { label: "teams", result: stageTeams() },
    { label: "players", result: stagePlayers() },
    { label: "schedule", result: stageSchedule() },
  ];

  const allErrors = stages.flatMap((s) => s.result.errors);
  if (allErrors.length) {
    console.error(
      `\n[provision] ${allErrors.length} validation error(s):\n` +
        allErrors.map((e) => "  ✗ " + e).join("\n"),
    );
    process.exit(1);
  }

  // Preview.
  for (const s of stages) {
    console.log(
      `[provision] ${s.label}: ${s.result.writes.length} write${s.result.writes.length === 1 ? "" : "s"}`,
    );
    for (const w of s.result.writes.slice(0, 3)) {
      console.log(`  · ${w.path}`);
    }
    if (s.result.writes.length > 3) {
      console.log(`  · …and ${s.result.writes.length - 3} more`);
    }
  }

  if (dryRun) {
    console.log("\n[provision] --dry-run — no writes performed.");
    return;
  }

  // Write — batched in chunks of 400 to stay under the 500-op limit.
  const allWrites = stages.flatMap((s) => s.result.writes);
  let written = 0;
  for (let i = 0; i < allWrites.length; i += 400) {
    const chunk = allWrites.slice(i, i + 400);
    const batch = db.batch();
    for (const w of chunk) {
      batch.set(db.doc(w.path), w.data, { merge: true });
    }
    await batch.commit();
    written += chunk.length;
    console.log(
      `[provision] Wrote ${written}/${allWrites.length} docs (chunk ${i / 400 + 1})`,
    );
  }

  // Admin claims (if requested).
  if (provision.admins?.length) {
    console.log(
      `\n[provision] Granting admin:${leagueId} to ${provision.admins.length} user(s)…`,
    );
    await grantAdminClaims(provision.admins);
  }

  console.log("\n[provision] Done.");
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[provision] Failed:", err);
    process.exit(1);
  });
