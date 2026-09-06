// POST /api/admin-schedule-generate
//
// Two admin-only actions behind the schedule generator:
//
//   { leagueId, action: "save_rules", blockedPairs, teamSettings, gamesPerTeam }
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
import { hasScope } from "@/lib/admin-roles";
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
  // SCOPED. hasScope() lets the full admin through as before, and also the one
  // scoped role that declares "schedule-gen" in lib/admin-roles.ts. Every other
  // admin route still tests `!== "admin"` directly and so refuses a scoped
  // caller outright, which is the intended default: access widens only where
  // someone wrote it down.
  if (!hasScope(decoded, leagueId, "schedule-gen")) {
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

    // Games each team plays. 0 means the old everyone-plays-everyone round
    // robin. Stored with the rest of the setup because it is a decision about
    // the SEASON, not about one press of Generate: Mike picked 8 games, saved,
    // came back the following week and the box had reset to the round robin.
    const rawGpt = (body as { gamesPerTeam?: unknown }).gamesPerTeam;
    const gamesPerTeam =
      typeof rawGpt === "number" && Number.isFinite(rawGpt)
        ? Math.max(0, Math.min(40, Math.floor(rawGpt)))
        : 0;

    await db.doc(`leagues/${leagueId}/site_config/schedule_rules`).set(
      {
        blocked_pairs: pairs,
        team_settings: teamSettings,
        games_per_team: gamesPerTeam,
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

  // ---- a team dropped out ------------------------------------------------
  // Mike, 2026-09-06: "We had a team drop but instead of redoing the whole
  // schedule can I just delete the team and adjust weeks."
  //
  // Rebuilding the season is the wrong answer to one team leaving: it moves
  // every other fixture, and coaches have already put those dates in diaries.
  // This removes only the departing team's games and then reports exactly who
  // is now short and by how many, which is the information needed to top them
  // up rather than start again.
  //
  // GAMES WITH RESULTS ARE NEVER TOUCHED. A team that quits in week six played
  // weeks one to five, and those results are the other teams' records. They are
  // reported and left exactly where they are.
  if (body.action === "remove_team") {
    const teamId = String((body as { teamId?: unknown }).teamId ?? "");
    if (!TEAM_ID_RE.test(teamId)) {
      return NextResponse.json({ error: "teamId required" }, { status: 400 });
    }
    // Default to today so history is safe even if the caller forgets. An
    // explicit date lets an admin clear a team from a future week only.
    const rawFrom = String((body as { from?: unknown }).from ?? "");
    const from = DATE_RE.test(rawFrom) ? rawFrom : now.slice(0, 10);
    const dryRun = (body as { dryRun?: unknown }).dryRun !== false;

    const [homeSnap, awaySnap] = await Promise.all([
      db.collection(`leagues/${leagueId}/games`).where("home_team_id", "==", teamId).get(),
      db.collection(`leagues/${leagueId}/games`).where("away_team_id", "==", teamId).get(),
    ]);
    const seen = new Set<string>();
    const all = [...homeSnap.docs, ...awaySnap.docs].filter((d) => {
      if (seen.has(d.id)) return false;
      seen.add(d.id);
      return true;
    });

    const hasResult = (d: FirebaseFirestore.QueryDocumentSnapshot) => {
      const v = d.data();
      const st = String(v.status ?? "");
      return st === "final" || st === "approved" || v.home_score != null;
    };

    const played = all.filter(hasResult);
    const removable = all.filter(
      (d) => !hasResult(d) && String(d.data().date ?? "") >= from,
    );
    const beforeFrom = all.filter(
      (d) => !hasResult(d) && String(d.data().date ?? "") < from,
    );

    // Who loses a fixture, and on which dates the slots free up. This is the
    // "adjust weeks" half of the question: nothing needs moving, but somebody
    // has to know which teams are now a game light.
    const opponentCount = new Map<string, number>();
    const freedSlots: { date: string; time: string; field: string }[] = [];
    for (const d of removable) {
      const v = d.data();
      const other =
        String(v.home_team_id ?? "") === teamId
          ? String(v.away_team_id ?? "")
          : String(v.home_team_id ?? "");
      if (other) opponentCount.set(other, (opponentCount.get(other) ?? 0) + 1);
      freedSlots.push({
        date: String(v.date ?? ""),
        time: String(v.time ?? ""),
        field: String(v.field ?? ""),
      });
    }
    freedSlots.sort((x, y) => x.date.localeCompare(y.date) || x.time.localeCompare(y.time));

    const summary = {
      ok: true,
      dryRun,
      teamId,
      wouldRemove: removable.length,
      keptWithResults: played.length,
      keptBeforeFrom: beforeFrom.length,
      from,
      opponents: [...opponentCount.entries()]
        .map(([id, games]) => ({ id, games }))
        .sort((a, b) => b.games - a.games),
      freedSlots: freedSlots.slice(0, 200),
    };

    // Dry run BY DEFAULT. Deleting a chunk of a live schedule on a typo is not
    // a recoverable mistake, so the caller has to ask twice.
    if (dryRun) return NextResponse.json(summary);

    for (let i = 0; i < removable.length; i += 400) {
      const batch = db.batch();
      removable.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
    try {
      await db.collection(`leagues/${leagueId}/audit`).add({
        kind: "remove_team_from_schedule",
        by_uid: decoded.uid,
        team_id: teamId,
        removed: removable.length,
        kept_with_results: played.length,
        from,
        at: now,
      });
    } catch {
      /* never fail the removal over the audit row */
    }
    return NextResponse.json({ ...summary, dryRun: false, removed: removable.length });
  }

  return NextResponse.json(
    {
      error:
        "action must be save_rules | create_games | undo_batch | remove_team",
    },
    { status: 400 },
  );
}
