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
    await db.doc(`leagues/${leagueId}/site_config/schedule_rules`).set(
      { blocked_pairs: pairs, updated_at: now, updated_by: decoded.uid },
      { merge: true },
    );
    return NextResponse.json({ ok: true, saved: pairs.length });
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
    });

    return NextResponse.json({ ok: true, created: clean.length, batch: now });
  }

  return NextResponse.json(
    { error: "action must be save_rules | create_games" },
    { status: 400 },
  );
}
