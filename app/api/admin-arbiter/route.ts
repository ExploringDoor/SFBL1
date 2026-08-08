// POST /api/admin-arbiter
//
// Arbiter round-trip for leagues that keep ArbiterSports as their schedule
// master and want the website to follow it rather than replace it.
//
//   { leagueId, action: "preview_import", csv }
//       Parse, resolve team names, check conflicts. Writes NOTHING.
//
//   { leagueId, action: "commit_import", csv, mapping? }
//       Same parse, then write. Idempotent: games are keyed on the Arbiter game
//       number, so re-importing an updated export UPDATES rows rather than
//       duplicating a 185-team season.
//
//   { leagueId, action: "save_aliases", aliases }
//       Remember that Arbiter's "Crusaders" is our "St. Leo's", so the mapping
//       is confirmed once rather than on every import.
//
//   { leagueId, action: "export" }
//       The league's current schedule as an Arbiter-shaped CSV.
//
// A NOTE ON CONFLICTS: unlike the schedule generator, a conflict here does NOT
// block the write. Arbiter is upstream and authoritative — if it says two games
// share a field, that is the league's actual situation and refusing the import
// would just leave the website empty. Instead the conflicts are reported back
// prominently, which makes this a free audit of the Arbiter schedule: the
// league finds out about its own double-bookings before the coaches do.

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";
import {
  parseArbiterSchedule,
  matchTeamNames,
  toArbiterCsv,
  arbiterGameId,
  type MatchableTeam,
} from "@/lib/arbiter";
import {
  findConflicts,
  type ConflictGame,
  type ConflictTeam,
} from "@/lib/schedule-conflicts";

export const runtime = "nodejs";

const BATCH_LIMIT = 450;
const MAX_ROWS = 4000;
const MAX_CSV_BYTES = 4_000_000;

export async function POST(req: Request) {
  const m = /^Bearer\s+(.+)$/.exec(req.headers.get("authorization") ?? "");
  if (!m) return NextResponse.json({ error: "missing bearer" }, { status: 401 });
  let decoded;
  try {
    decoded = await getAdminAuth().verifyIdToken(m[1]!);
  } catch {
    return NextResponse.json({ error: "invalid token" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const leagueId = typeof body.leagueId === "string" ? body.leagueId : "";
  if (!leagueId || !/^[a-z][a-z0-9-]+$/i.test(leagueId)) {
    return NextResponse.json({ error: "leagueId required" }, { status: 400 });
  }
  const claim = (decoded.leagues as Record<string, string> | undefined)?.[leagueId];
  if (claim !== "admin") {
    return NextResponse.json({ error: "not admin" }, { status: 403 });
  }

  const db = getAdminDb();
  const now = new Date().toISOString();
  const action = String(body.action ?? "");

  // ---- shared: the league's teams, with any saved Arbiter aliases ---------
  async function loadTeams(): Promise<MatchableTeam[]> {
    const [teamSnap, aliasSnap] = await Promise.all([
      db.collection(`leagues/${leagueId}/teams`).get(),
      db.doc(`leagues/${leagueId}/site_config/arbiter`).get(),
    ]);
    const aliasMap = (aliasSnap.data()?.aliases ?? {}) as Record<string, string>;
    // Stored the natural way round for editing (arbiterName -> teamId); invert
    // it into the per-team alias lists the matcher wants.
    const byTeam = new Map<string, string[]>();
    for (const [arbiterName, teamId] of Object.entries(aliasMap)) {
      byTeam.set(teamId, [...(byTeam.get(teamId) ?? []), arbiterName]);
    }
    const out: MatchableTeam[] = [];
    teamSnap.forEach((d) => {
      const t = d.data() as Record<string, unknown>;
      out.push({
        id: d.id,
        name: String(t.name ?? d.id),
        abbrev: t.abbrev ? String(t.abbrev) : null,
        aliases: byTeam.get(d.id) ?? [],
      });
    });
    return out;
  }

  // ---- save confirmed name mappings --------------------------------------
  if (action === "save_aliases") {
    const raw = body.aliases;
    if (!raw || typeof raw !== "object") {
      return NextResponse.json({ error: "aliases object required" }, { status: 400 });
    }
    const aliases: Record<string, string> = {};
    for (const [name, teamId] of Object.entries(raw as Record<string, unknown>)) {
      const n = String(name).trim().slice(0, 120);
      const id = String(teamId ?? "").trim();
      if (!n || !id || !/^[a-z0-9_-]+$/i.test(id)) continue;
      aliases[n] = id;
    }
    await db.doc(`leagues/${leagueId}/site_config/arbiter`).set(
      { aliases, updated_at: now, updated_by: decoded.uid },
      { merge: true },
    );
    return NextResponse.json({ ok: true, saved: Object.keys(aliases).length });
  }

  // ---- export the current schedule ---------------------------------------
  if (action === "export") {
    const [teams, gameSnap] = await Promise.all([
      loadTeams(),
      db.collection(`leagues/${leagueId}/games`).get(),
    ]);
    const games = gameSnap.docs.map((d) => {
      const gd = d.data() as Record<string, unknown>;
      return {
        arbiter_game_number: gd.arbiter_game_number ? String(gd.arbiter_game_number) : null,
        date: String(gd.date ?? "").slice(0, 10),
        time: gd.time ? String(gd.time) : null,
        field: gd.field ? String(gd.field) : null,
        away_team_id: String(gd.away_team_id ?? ""),
        home_team_id: String(gd.home_team_id ?? ""),
        away_score: typeof gd.away_score === "number" ? gd.away_score : null,
        home_score: typeof gd.home_score === "number" ? gd.home_score : null,
        division: gd.division ? String(gd.division) : null,
      };
    }).filter((g) => g.date && g.away_team_id && g.home_team_id);

    return NextResponse.json({
      ok: true,
      csv: toArbiterCsv(games, teams),
      count: games.length,
      filename: `${leagueId}-schedule-${now.slice(0, 10)}.csv`,
    });
  }

  if (action !== "preview_import" && action !== "commit_import") {
    return NextResponse.json(
      { error: "action must be preview_import | commit_import | save_aliases | export" },
      { status: 400 },
    );
  }

  // ---- import (shared preview / commit path) ------------------------------
  const csv = typeof body.csv === "string" ? body.csv : "";
  if (!csv.trim()) {
    return NextResponse.json({ error: "csv required" }, { status: 400 });
  }
  if (csv.length > MAX_CSV_BYTES) {
    return NextResponse.json({ error: "file too large" }, { status: 400 });
  }

  const parsed = parseArbiterSchedule(csv);
  if (parsed.rows.length === 0) {
    return NextResponse.json(
      {
        error: "No usable game rows found.",
        errors: parsed.errors.slice(0, 50),
        warnings: parsed.warnings,
      },
      { status: 400 },
    );
  }
  if (parsed.rows.length > MAX_ROWS) {
    return NextResponse.json(
      { error: `${parsed.rows.length} rows exceeds the ${MAX_ROWS} limit.` },
      { status: 400 },
    );
  }

  const teams = await loadTeams();
  const sourceNames = parsed.rows.flatMap((r) => [r.awayName, r.homeName]);
  const matches = matchTeamNames(sourceNames, teams);

  // A mapping supplied by the admin in this request wins over auto-matching —
  // that is how an ambiguous or unknown name gets resolved.
  const manual = (body.mapping ?? {}) as Record<string, unknown>;
  const resolved = new Map<string, string>();
  for (const mt of matches) {
    if (mt.teamId) resolved.set(mt.sourceName, mt.teamId);
  }
  for (const [name, teamId] of Object.entries(manual)) {
    const id = String(teamId ?? "").trim();
    if (id && /^[a-z0-9_-]+$/i.test(id)) resolved.set(String(name).trim(), id);
  }

  const unresolved = matches
    .filter((mt) => !resolved.has(mt.sourceName))
    .map((mt) => ({
      name: mt.sourceName,
      confidence: mt.confidence,
      candidates: mt.candidates,
    }));

  // Rows whose teams both resolve are importable; the rest are held back and
  // named, so a partial import is explicit rather than silent.
  const importable: {
    id: string;
    doc: Record<string, unknown>;
    conflictShape: ConflictGame;
  }[] = [];
  const skipped: { line: number; reason: string }[] = [];

  for (const r of parsed.rows) {
    const awayId = resolved.get(r.awayName);
    const homeId = resolved.get(r.homeName);
    if (!awayId || !homeId) {
      skipped.push({
        line: r.line,
        reason: `Unmatched team: ${!awayId ? r.awayName : r.homeName}`,
      });
      continue;
    }
    if (awayId === homeId) {
      skipped.push({ line: r.line, reason: "Home and away resolve to the same team" });
      continue;
    }
    const id = arbiterGameId({
      gameNumber: r.gameNumber ?? null,
      date: r.date,
      awayTeamId: awayId,
      homeTeamId: homeId,
    });
    const played = r.awayScore != null && r.homeScore != null;
    importable.push({
      id,
      doc: {
        date: r.date,
        time: r.time,
        field: r.field,
        away_team_id: awayId,
        home_team_id: homeId,
        ...(r.division ? { division: r.division } : {}),
        ...(r.gameNumber ? { arbiter_game_number: r.gameNumber } : {}),
        ...(played
          ? { away_score: r.awayScore, home_score: r.homeScore, status: "final" }
          : { status: "scheduled" }),
        source: "arbiter",
        arbiter_imported_at: now,
      },
      conflictShape: {
        id,
        date: r.date,
        time: r.time,
        field: r.field,
        away_team_id: awayId,
        home_team_id: homeId,
        division: r.division,
      },
    });
  }

  // Conflict audit. Games being re-imported are excluded from the "existing"
  // set by id, or every row would appear to collide with its own previous
  // version and the report would be pure noise.
  const incomingIds = new Set(importable.map((g) => g.id));
  const existingSnap = await db.collection(`leagues/${leagueId}/games`).get();
  const existingGames: ConflictGame[] = [];
  existingSnap.forEach((d) => {
    if (incomingIds.has(d.id)) return;
    const gd = d.data() as Record<string, unknown>;
    const date = String(gd.date ?? "").slice(0, 10);
    if (!date) return;
    existingGames.push({
      id: d.id,
      date,
      time: String(gd.time ?? ""),
      field: String(gd.field ?? ""),
      away_team_id: String(gd.away_team_id ?? ""),
      home_team_id: String(gd.home_team_id ?? ""),
      division: gd.division ? String(gd.division) : undefined,
    });
  });

  const rulesSnap = await db.doc(`leagues/${leagueId}/site_config/schedule_rules`).get();
  const teamSettings = (rulesSnap.data()?.team_settings ?? {}) as Record<
    string,
    { allowedFields?: string[]; unavailable?: string[] }
  >;
  const conflictTeams: ConflictTeam[] = teams.map((t) => ({
    id: t.id,
    name: t.name,
    allowedFields: teamSettings[t.id]?.allowedFields ?? null,
    unavailable: teamSettings[t.id]?.unavailable ?? null,
  }));

  const conflicts = findConflicts(
    importable.map((g) => g.conflictShape),
    {
      existingGames,
      teams: conflictTeams,
      gameMinutes: Number(rulesSnap.data()?.game_minutes ?? 0) || 0,
    },
  );

  const summary = {
    parsedRows: parsed.rows.length,
    importable: importable.length,
    skipped: skipped.length,
    unresolvedTeams: unresolved.length,
    conflicts: conflicts.filter((c) => c.severity === "error").length,
    warningConflicts: conflicts.filter((c) => c.severity === "warning").length,
    newGames: importable.filter((g) => !existingSnap.docs.some((d) => d.id === g.id)).length,
    delimiter: parsed.delimiter,
    ignoredColumns: parsed.ignoredColumns,
  };

  if (action === "preview_import") {
    return NextResponse.json({
      ok: true,
      preview: true,
      summary,
      unresolved,
      skipped: skipped.slice(0, 100),
      parseErrors: parsed.errors.slice(0, 100),
      parseWarnings: parsed.warnings,
      // The audit value: what Arbiter's own schedule double-books.
      conflicts: conflicts.slice(0, 100),
      sample: importable.slice(0, 20).map((g) => ({ id: g.id, ...g.doc })),
    });
  }

  // ---- commit -------------------------------------------------------------
  if (importable.length === 0) {
    return NextResponse.json(
      { error: "Nothing importable — resolve the team names first.", unresolved },
      { status: 400 },
    );
  }

  const col = db.collection(`leagues/${leagueId}/games`);
  for (let i = 0; i < importable.length; i += BATCH_LIMIT) {
    const batch = db.batch();
    for (const g of importable.slice(i, i + BATCH_LIMIT)) {
      // merge:true so an import refreshes date/time/field/score without
      // clobbering anything the site owns (box scores, recaps, captain notes).
      batch.set(col.doc(g.id), g.doc, { merge: true });
    }
    await batch.commit();
  }

  await db.collection(`leagues/${leagueId}/audit`).add({
    kind: "arbiter_import",
    at: now,
    by_uid: decoded.uid,
    count: importable.length,
    skipped: skipped.length,
    conflicts: summary.conflicts,
  });

  return NextResponse.json({
    ok: true,
    imported: importable.length,
    summary,
    skipped: skipped.slice(0, 100),
    conflicts: conflicts.slice(0, 100),
  });
}
