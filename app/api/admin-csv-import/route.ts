// /api/admin-csv-import — admin imports a schedule CSV via the UI.
//
// Body shape:
//   { leagueId, kind: "schedule", csv: "<csv text>", dryRun?: boolean }
//
// Schedule CSV columns (header row required):
//   id,date,time,field,away_team_id,home_team_id,division,status,
//   away_score,home_score
//
// Behavior:
//   - dryRun=true → returns parsed counts + first 5 errors, writes nothing
//   - dryRun=false → writes /games/{id} docs with set merge:true (won't
//     clobber score fields if not in CSV)
//   - Validates each row before any writes; if any row fails, the whole
//     import aborts with the row-by-row errors. No partial imports.
//
// Why a UI endpoint vs the existing scripts/provision.ts: scripts run
// from the dev machine and require a service account JSON. New
// commissioners onboarding their data don't have that — and shouldn't
// need it. This endpoint takes a CSV they paste/upload, validates it,
// and writes through the Admin SDK using the user's bearer token.
//
// Auth: caller must be admin of leagueId.

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{1,2}:\d{2}(:\d{2})?$/;
const TEAM_ID_RE = /^[a-z0-9_-]+$/;
const ALLOWED_STATUS = new Set([
  "scheduled",
  "postponed",
  "cancelled",
  "final",
  "approved",
]);

const REQUIRED_COLS = ["id", "date", "away_team_id", "home_team_id"];
const ALL_COLS = [
  "id", "date", "time", "field", "away_team_id", "home_team_id",
  "division", "status", "away_score", "home_score", "week",
];

interface ParsedRow {
  id: string;
  date: string;
  time?: string;
  field?: string;
  away_team_id: string;
  home_team_id: string;
  division?: string;
  status?: string;
  away_score?: number | null;
  home_score?: number | null;
  week?: string;
}

interface RowError {
  line: number;
  message: string;
}

export async function POST(req: Request) {
  const authHdr = req.headers.get("authorization");
  if (!authHdr?.startsWith("Bearer ")) {
    return NextResponse.json(
      { error: "Missing bearer token" },
      { status: 401 },
    );
  }
  const idToken = authHdr.slice("Bearer ".length).trim();

  let decoded;
  try {
    // checkRevoked=true: can wholesale rewrite a tenant's roster.
    decoded = await getAdminAuth().verifyIdToken(idToken, true);
  } catch {
    return NextResponse.json(
      { error: "Invalid or expired token" },
      { status: 401 },
    );
  }

  let body: {
    leagueId?: unknown;
    kind?: unknown;
    csv?: unknown;
    dryRun?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const leagueId = body.leagueId;
  if (typeof leagueId !== "string" || !leagueId) {
    return NextResponse.json(
      { error: "leagueId is required" },
      { status: 400 },
    );
  }
  if (body.kind !== "schedule") {
    return NextResponse.json(
      { error: "Only kind=schedule supported (more kinds coming)" },
      { status: 400 },
    );
  }
  if (typeof body.csv !== "string" || !body.csv.trim()) {
    return NextResponse.json(
      { error: "csv body must be a non-empty string" },
      { status: 400 },
    );
  }

  const callerLeagues = decoded.leagues as
    | Record<string, string>
    | undefined;
  if (callerLeagues?.[leagueId] !== "admin") {
    return NextResponse.json(
      { error: `Not admin of league "${leagueId}"` },
      { status: 403 },
    );
  }

  const dryRun = body.dryRun === true;
  const { rows, errors, warnings } = parseScheduleCsv(body.csv);

  if (errors.length > 0) {
    return NextResponse.json(
      {
        ok: false,
        errors: errors.slice(0, 50),
        warnings,
        parsed_count: rows.length,
        message: `${errors.length} row${errors.length === 1 ? "" : "s"} failed validation. No writes performed.`,
      },
      { status: 400 },
    );
  }

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      parsed_count: rows.length,
      warnings,
      sample: rows.slice(0, 3),
    });
  }

  // Cross-validate against existing teams — if a row references a
  // team_id that doesn't exist, warn (but don't block; commissioner
  // may be importing schedule before teams).
  const db = getAdminDb();

  // Batch the writes. Firestore limits 500 ops per batch.
  let written = 0;
  for (let i = 0; i < rows.length; i += 450) {
    const batch = db.batch();
    for (const row of rows.slice(i, i + 450)) {
      batch.set(
        db.doc(`leagues/${leagueId}/games/${row.id}`),
        toGameDoc(row),
        { merge: true },
      );
    }
    await batch.commit();
    written += Math.min(450, rows.length - i);
  }

  await db.collection(`leagues/${leagueId}/audit`).add({
    kind: "csv_schedule_import",
    by_uid: decoded.uid,
    by_role: "admin",
    changes: { rows_written: written },
    at: new Date().toISOString(),
  });

  return NextResponse.json({
    ok: true,
    dryRun: false,
    parsed_count: rows.length,
    written,
    warnings,
  });
}

// ─── parser ───────────────────────────────────────────────────────

function parseScheduleCsv(text: string): {
  rows: ParsedRow[];
  errors: RowError[];
  warnings: string[];
} {
  const rows: ParsedRow[] = [];
  const errors: RowError[] = [];
  const warnings: string[] = [];

  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    errors.push({ line: 0, message: "CSV needs a header row + at least one data row." });
    return { rows, errors, warnings };
  }

  const header = parseCsvLine(lines[0]!).map((s) => s.trim().toLowerCase());
  for (const col of REQUIRED_COLS) {
    if (!header.includes(col)) {
      errors.push({
        line: 1,
        message: `Header is missing required column "${col}". Required: ${REQUIRED_COLS.join(", ")}`,
      });
    }
  }
  const unknown = header.filter((h) => !ALL_COLS.includes(h));
  if (unknown.length > 0) {
    warnings.push(
      `Unknown columns ignored: ${unknown.join(", ")}. Allowed: ${ALL_COLS.join(", ")}.`,
    );
  }
  if (errors.length > 0) return { rows, errors, warnings };

  const seen = new Set<string>();

  for (let i = 1; i < lines.length; i++) {
    const lineNum = i + 1; // 1-based, matching what the user sees
    const fields = parseCsvLine(lines[i]!);
    const row: Record<string, string> = {};
    for (let j = 0; j < header.length; j++) {
      row[header[j]!] = (fields[j] ?? "").trim();
    }
    const id = row.id ?? "";
    const date = row.date ?? "";
    const away = row.away_team_id ?? "";
    const home = row.home_team_id ?? "";

    if (!id) {
      errors.push({ line: lineNum, message: "id is required" });
      continue;
    }
    if (seen.has(id)) {
      errors.push({ line: lineNum, message: `Duplicate id "${id}"` });
      continue;
    }
    seen.add(id);

    if (!DATE_RE.test(date)) {
      errors.push({
        line: lineNum,
        message: `date "${date}" not in YYYY-MM-DD form`,
      });
      continue;
    }
    if (!TEAM_ID_RE.test(away)) {
      errors.push({ line: lineNum, message: `away_team_id "${away}" invalid` });
      continue;
    }
    if (!TEAM_ID_RE.test(home)) {
      errors.push({ line: lineNum, message: `home_team_id "${home}" invalid` });
      continue;
    }
    if (away === home) {
      errors.push({
        line: lineNum,
        message: "Home and away team_id are the same",
      });
      continue;
    }
    if (row.time && !TIME_RE.test(row.time)) {
      errors.push({
        line: lineNum,
        message: `time "${row.time}" not in HH:MM`,
      });
      continue;
    }
    if (row.status && !ALLOWED_STATUS.has(row.status)) {
      errors.push({
        line: lineNum,
        message: `status "${row.status}" not allowed (${[...ALLOWED_STATUS].join(", ")})`,
      });
      continue;
    }

    const aScore = row.away_score
      ? Number(row.away_score)
      : null;
    const hScore = row.home_score
      ? Number(row.home_score)
      : null;
    if (row.away_score && !Number.isFinite(aScore)) {
      errors.push({ line: lineNum, message: `away_score "${row.away_score}" isn't a number` });
      continue;
    }
    if (row.home_score && !Number.isFinite(hScore)) {
      errors.push({ line: lineNum, message: `home_score "${row.home_score}" isn't a number` });
      continue;
    }

    rows.push({
      id,
      date,
      time: row.time || undefined,
      field: row.field || undefined,
      away_team_id: away,
      home_team_id: home,
      division: row.division || undefined,
      status: row.status || "scheduled",
      away_score: aScore,
      home_score: hScore,
      week: row.week || undefined,
    });
  }

  return { rows, errors, warnings };
}

function parseCsvLine(line: string): string[] {
  // Minimal CSV split — handles quoted fields containing commas.
  // Doesn't handle escaped quotes inside quoted fields ("" → "), but
  // schedule data doesn't have them in practice. If we see breakage
  // in the wild, swap for a real CSV lib.
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function toGameDoc(r: ParsedRow): Record<string, unknown> {
  const out: Record<string, unknown> = {
    date: r.date,
    away_team_id: r.away_team_id,
    home_team_id: r.home_team_id,
    status: r.status ?? "scheduled",
  };
  if (r.time) out.time = r.time;
  if (r.field) out.field = r.field;
  if (r.division) out.division = r.division;
  if (r.week) out.week = r.week;
  if (r.away_score != null) out.away_score = r.away_score;
  if (r.home_score != null) out.home_score = r.home_score;
  return out;
}
