// POST /api/admin-schedule-generate
//
// Two admin-only actions behind the schedule generator:
//
//   { leagueId, action: "save_rules", blockedPairs }
//       Persist the "these two teams never play each other" list to
//       /leagues/<id>/site_config/schedule_rules so Mike sets it once rather
//       than re-picking every time he builds a schedule.
//
//   { leagueId, action: "create_games", games: [...] }
//       Bulk-write a generated schedule. The generator runs client-side (it is
//       pure, see lib/schedule-generator.ts) so the admin can preview before
//       committing; this endpoint only writes what was previewed.
//
// Why bulk rather than looping the existing single-game create endpoint: a
// season is easily 100+ games, and one request per game means a half-written
// schedule if the tab is closed midway. A batch is all-or-nothing.

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";
import {
  findConflicts,
  type ConflictGame,
  type ConflictTeam,
} from "@/lib/schedule-conflicts";

export const runtime = "nodejs";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;
const TEAM_ID_RE = /^[a-z0-9_-]+$/i;
// Firestore caps a batch at 500 writes. A season can exceed that, so the
// writes are chunked; MAX_GAMES keeps a runaway request from writing forever.
const BATCH_LIMIT = 450;
const MAX_GAMES = 2000;

interface GameIn {
  date?: unknown;
  time?: unknown;
  field?: unknown;
  away_team_id?: unknown;
  home_team_id?: unknown;
  division?: unknown;
  week?: unknown;
}

export async function POST(req: Request) {
  const m = /^Bearer\s+(.+)$/.exec(req.headers.get("authorization") ?? "");
  if (!m) {
    return NextResponse.json({ error: "missing bearer" }, { status: 401 });
  }
  let decoded;
  try {
    decoded = await getAdminAuth().verifyIdToken(m[1]!);
  } catch {
    return NextResponse.json({ error: "invalid token" }, { status: 401 });
  }

  let body: {
    leagueId?: unknown;
    action?: unknown;
    blockedPairs?: unknown;
    games?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
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

  // ---- save the blocked-pairs list --------------------------------------
  if (body.action === "save_rules") {
    const raw = Array.isArray(body.blockedPairs) ? body.blockedPairs : [];
    const seen = new Set<string>();
    const pairs: [string, string][] = [];
    for (const p of raw) {
      if (!Array.isArray(p) || p.length !== 2) continue;
      const [a, b] = [String(p[0] ?? ""), String(p[1] ?? "")];
      if (!a || !b || a === b) continue;
      if (!TEAM_ID_RE.test(a) || !TEAM_ID_RE.test(b)) continue;
      // Store normalised + de-duped so ["a","b"] and ["b","a"] are one rule.
      const key = [a, b].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push([a, b]);
    }
    // Per-team scheduling settings, kept here rather than on the team doc:
    // they are scheduling concerns, they change season to season, and keeping
    // them beside the blocked pairs means the generator reads one document.
    const rawTs = (body as { teamSettings?: unknown }).teamSettings;
    const teamSettings: Record<
      string,
      {
        organization?: string;
        homeField?: string;
        unavailable?: string[];
        allowedFields?: string[];
      }
    > = {};
    if (rawTs && typeof rawTs === "object") {
      for (const [teamId, v] of Object.entries(rawTs as Record<string, unknown>)) {
        if (!TEAM_ID_RE.test(teamId) || !v || typeof v !== "object") continue;
        const s = v as Record<string, unknown>;
        const org = typeof s.organization === "string" ? s.organization.trim().slice(0, 80) : "";
        const hf = typeof s.homeField === "string" ? s.homeField.trim().slice(0, 120) : "";
        const un = Array.isArray(s.unavailable)
          ? [
              ...new Set(
                s.unavailable
                  .map((d) => String(d))
                  .filter((d) => DATE_RE.test(d)),
              ),
            ].sort()
          : [];
        // Fields this team may play at at all. An empty list is meaningful in
        // the UI ("no restriction") and is simply not stored.
        const af = Array.isArray(s.allowedFields)
          ? [
              ...new Set(
                s.allowedFields
                  .map((f) => String(f).trim().slice(0, 120))
                  .filter(Boolean),
              ),
            ]
          : [];
        // Skip teams with nothing set, so the doc stays readable.
        if (!org && !hf && un.length === 0 && af.length === 0) continue;
        teamSettings[teamId] = {
          ...(org ? { organization: org } : {}),
          ...(hf ? { homeField: hf } : {}),
          ...(un.length ? { unavailable: un } : {}),
          ...(af.length ? { allowedFields: af } : {}),
        };
      }
    }

    await db.doc(`leagues/${leagueId}/site_config/schedule_rules`).set(
      {
        blocked_pairs: pairs,
        team_settings: teamSettings,
        updated_at: now,
        updated_by: decoded.uid,
      },
      { merge: true },
    );
    return NextResponse.json({
      ok: true,
      saved: pairs.length,
      teamsConfigured: Object.keys(teamSettings).length,
    });
  }

  // ---- bulk-create a generated schedule ---------------------------------
  if (body.action === "create_games") {
    const raw = Array.isArray(body.games) ? (body.games as GameIn[]) : [];
    if (raw.length === 0) {
      return NextResponse.json({ error: "no games supplied" }, { status: 400 });
    }
    if (raw.length > MAX_GAMES) {
      return NextResponse.json(
        { error: `too many games (${raw.length}); max ${MAX_GAMES}` },
        { status: 400 },
      );
    }

    // Validate everything BEFORE writing anything, so a bad row can't leave a
    // half-created schedule behind.
    const clean: Record<string, unknown>[] = [];
    for (let i = 0; i < raw.length; i++) {
      const g = raw[i]!;
      const date = String(g.date ?? "");
      const away = String(g.away_team_id ?? "");
      const home = String(g.home_team_id ?? "");
      if (!DATE_RE.test(date)) {
        return NextResponse.json(
          { error: `game ${i + 1}: date must be YYYY-MM-DD` },
          { status: 400 },
        );
      }
      if (!TEAM_ID_RE.test(away) || !TEAM_ID_RE.test(home)) {
        return NextResponse.json(
          { error: `game ${i + 1}: home and away team ids are required` },
          { status: 400 },
        );
      }
      if (away === home) {
        return NextResponse.json(
          { error: `game ${i + 1}: a team cannot play itself` },
          { status: 400 },
        );
      }
      const time = g.time == null ? "" : String(g.time);
      if (time && !TIME_RE.test(time)) {
        return NextResponse.json(
          { error: `game ${i + 1}: time must be HH:MM` },
          { status: 400 },
        );
      }
      clean.push({
        date,
        time,
        field: g.field == null ? "" : String(g.field).trim(),
        away_team_id: away,
        home_team_id: home,
        ...(g.division ? { division: String(g.division).trim() } : {}),
        ...(g.week == null ? {} : { week: Number(g.week) }),
        status: "scheduled",
        created_at: now,
        created_by_uid: decoded.uid,
        // Marks the row as machine-generated, so a future "undo this
        // generation" can find exactly these without touching hand-added games.
        generated_batch: now,
      });
    }

    // ---- conflict gate ----------------------------------------------------
    // The generator already avoids conflicts, and the admin UI previews them,
    // but neither is authoritative: a preview can be minutes stale, two admins
    // can generate at once, and games can be hand-posted straight to this
    // endpoint. So the check runs again here against live data, and this is the
    // one that decides. `force: true` lets an admin knowingly override a
    // warning-free-but-conflicting write; it is recorded in the audit entry.
    const force = (body as { force?: unknown }).force === true;

    const rulesSnap = await db
      .doc(`leagues/${leagueId}/site_config/schedule_rules`)
      .get();
    const teamSettings = (rulesSnap.data()?.team_settings ?? {}) as Record<
      string,
      { allowedFields?: string[]; unavailable?: string[] }
    >;

    // Only games on the dates being written can possibly conflict, so the read
    // is scoped to those rather than pulling a whole season.
    const dates = [...new Set(clean.map((g) => String(g.date)))].sort();
    const existingGames: ConflictGame[] = [];
    if (dates.length > 0) {
      // Firestore caps an `in` filter at 30 values; a range over the sorted
      // bounds covers any date span in one query and is filtered below.
      const snap = await db
        .collection(`leagues/${leagueId}/games`)
        .where("date", ">=", dates[0]!)
        .where("date", "<=", dates[dates.length - 1]!)
        .get();
      const wanted = new Set(dates);
      for (const d of snap.docs) {
        const data = d.data();
        if (!wanted.has(String(data.date ?? ""))) continue;
        existingGames.push({
          id: d.id,
          date: String(data.date ?? ""),
          time: String(data.time ?? ""),
          field: String(data.field ?? ""),
          away_team_id: String(data.away_team_id ?? ""),
          home_team_id: String(data.home_team_id ?? ""),
          division: data.division ? String(data.division) : undefined,
        });
      }
    }

    const teamsForCheck: ConflictTeam[] = Object.entries(teamSettings).map(
      ([id, s]) => ({
        id,
        allowedFields: s?.allowedFields ?? null,
        unavailable: s?.unavailable ?? null,
      }),
    );

    const conflicts = findConflicts(
      clean as unknown as ConflictGame[],
      {
        existingGames,
        teams: teamsForCheck,
        gameMinutes: Number(rulesSnap.data()?.game_minutes ?? 0) || 0,
      },
    );
    const blocking = conflicts.filter((c) => c.severity === "error");
    if (blocking.length > 0 && !force) {
      return NextResponse.json(
        {
          error: `${blocking.length} scheduling conflict${blocking.length === 1 ? "" : "s"}. Nothing was saved.`,
          conflicts: blocking.slice(0, 50),
          conflictCount: blocking.length,
          warnings: conflicts.filter((c) => c.severity === "warning").slice(0, 50),
        },
        { status: 409 },
      );
    }

    const col = db.collection(`leagues/${leagueId}/games`);
    for (let i = 0; i < clean.length; i += BATCH_LIMIT) {
      const batch = db.batch();
      for (const g of clean.slice(i, i + BATCH_LIMIT)) {
        batch.set(col.doc(), g);
      }
      await batch.commit();
    }

    await db.collection(`leagues/${leagueId}/audit`).add({
      kind: "schedule_generated",
      at: now,
      by_uid: decoded.uid,
      count: clean.length,
      batch: now,
      // A forced save is the one case where games were written over a known
      // conflict. Recorded so "why are two games on that field" is answerable.
      ...(blocking.length > 0 ? { forced_over_conflicts: blocking.length } : {}),
    });

    return NextResponse.json({
      ok: true,
      created: clean.length,
      batch: now,
      warnings: conflicts.filter((c) => c.severity === "warning").slice(0, 50),
      ...(blocking.length > 0 ? { forcedOverConflicts: blocking.length } : {}),
    });
  }

  // ---- undo the last generated batch ------------------------------------
  // Every generated game carries `generated_batch`, so an undo can remove
  // exactly one run and never touch a hand-added game. Refuses once any game
  // in the batch has been played, since deleting those would take real results
  // with them.
  if (body.action === "undo_batch") {
    const batch = typeof (body as { batch?: unknown }).batch === "string"
      ? (body as { batch: string }).batch
      : "";
    if (!batch) {
      return NextResponse.json({ error: "batch required" }, { status: 400 });
    }
    const snap = await db
      .collection(`leagues/${leagueId}/games`)
      .where("generated_batch", "==", batch)
      .get();
    if (snap.empty) {
      return NextResponse.json({ error: "nothing found for that batch" }, { status: 404 });
    }
    const played = snap.docs.filter((d) => {
      const s = String(d.data().status ?? "");
      return s === "final" || s === "approved" || d.data().home_score != null;
    });
    if (played.length > 0) {
      return NextResponse.json(
        {
          error:
            `${played.length} of these games already have results. Delete those ` +
            `by hand in the Schedule tab if you really mean to.`,
        },
        { status: 409 },
      );
    }
    for (let i = 0; i < snap.docs.length; i += BATCH_LIMIT) {
      const wb = db.batch();
      snap.docs.slice(i, i + BATCH_LIMIT).forEach((d) => wb.delete(d.ref));
      await wb.commit();
    }
    await db.collection(`leagues/${leagueId}/audit`).add({
      kind: "schedule_generation_undone",
      at: now,
      by_uid: decoded.uid,
      count: snap.size,
      batch,
    });
    return NextResponse.json({ ok: true, deleted: snap.size });
  }

  return NextResponse.json(
    { error: "action must be save_rules | create_games | undo_batch" },
    { status: 400 },
  );
}
