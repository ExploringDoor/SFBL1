// /api/admin-schedule-drafts — a schedule you have built but not posted, and
// the switch that hides a live one while you move it around.
//
// Mike, 2026-09-06: "can we have an option to save a schedule but not post it
// live. And once I post it live can we have a button to make it visible and
// invisible if I am working and moving things around?"
//
// Two different problems, and they get two different mechanisms on purpose.
//
// A DRAFT IS NOT A HIDDEN GAME. Fifteen places in this codebase read the games
// collection: the schedule, scores, standings, teams, the home page, the
// ticker, print sheets, the calendar feed, the CSV, the pregame reminder. A
// draft implemented as `published: false` on a game would have to be filtered
// out of all fifteen, and missing one means an unposted schedule turns up on
// the public site or, worse, texts every coach a fixture that is not real.
// So a draft is stored OUTSIDE the games collection entirely, here. Nothing
// public can read it because nothing public knows it exists, and firestore
// rules deny this path to every client anyway; only this route touches it.
// Posting a draft writes it through the normal create_games path, which keeps
// the conflict gate and the undo batch.
//
// HIDING A LIVE SCHEDULE IS THE OPPOSITE PROBLEM. The games are real, they may
// already carry results, and moving them anywhere would break every reference
// to them. So that is one flag in one document, read by the pages that show
// FIXTURES. Results and standings keep showing, because a game that has been
// played is not part of the reshuffle.
//
// Actions: save | list | load | delete | set_visibility

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";
import { hasScope } from "@/lib/admin-roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;
const TEAM_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
/** Same cap as create_games: a draft that cannot be posted is not a draft. */
const MAX_GAMES = 600;
/** Plenty for a season's working copies, and keeps the list readable. */
const MAX_DRAFTS = 25;

interface GameIn {
  date?: unknown;
  time?: unknown;
  field?: unknown;
  away_team_id?: unknown;
  home_team_id?: unknown;
  division?: unknown;
  week?: unknown;
}

/** Validate to exactly what create_games will accept later. A draft that only
 *  fails on the day you try to post it is a trap, so it fails now instead. */
function cleanGames(raw: unknown): { games: Record<string, unknown>[] } | { error: string } {
  const list = Array.isArray(raw) ? (raw as GameIn[]) : null;
  if (!list || list.length === 0) return { error: "no games in this draft" };
  if (list.length > MAX_GAMES) {
    return { error: `too many games (${list.length}); max ${MAX_GAMES}` };
  }
  const games: Record<string, unknown>[] = [];
  for (let i = 0; i < list.length; i++) {
    const g = list[i]!;
    const date = String(g.date ?? "");
    const away = String(g.away_team_id ?? "");
    const home = String(g.home_team_id ?? "");
    const time = g.time == null ? "" : String(g.time);
    if (!DATE_RE.test(date)) return { error: `game ${i + 1}: bad date` };
    if (!TEAM_ID_RE.test(away) || !TEAM_ID_RE.test(home)) {
      return { error: `game ${i + 1}: home and away team ids are required` };
    }
    if (away === home) return { error: `game ${i + 1}: a team cannot play itself` };
    if (time && !TIME_RE.test(time)) return { error: `game ${i + 1}: bad time` };
    games.push({
      date,
      time,
      field: g.field == null ? "" : String(g.field).trim(),
      away_team_id: away,
      home_team_id: home,
      ...(g.division ? { division: String(g.division).trim() } : {}),
      ...(g.week == null ? {} : { week: Number(g.week) }),
    });
  }
  return { games };
}

export async function POST(req: Request) {
  const m = /^Bearer\s+(.+)$/.exec(req.headers.get("authorization") ?? "");
  if (!m) return NextResponse.json({ error: "missing bearer" }, { status: 401 });
  let decoded;
  try {
    decoded = await getAdminAuth().verifyIdToken(m[1]!);
  } catch {
    return NextResponse.json({ error: "invalid token" }, { status: 401 });
  }

  let body: {
    leagueId?: unknown;
    action?: unknown;
    id?: unknown;
    name?: unknown;
    games?: unknown;
    division?: unknown;
    hidden?: unknown;
    note?: unknown;
    releaseNote?: unknown;
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
  const action = String(body.action ?? "");

  // Hiding the schedule belongs to whoever RUNS the schedule, which includes
  // the assistant; building drafts is the generator's own scope.
  const scope = action === "set_visibility" ? "schedule" : "schedule-gen";
  if (!hasScope(decoded, leagueId, scope)) {
    return NextResponse.json({ error: "not admin" }, { status: 403 });
  }

  const db = getAdminDb();
  const now = new Date().toISOString();
  const who = decoded.email ?? decoded.uid;
  const col = db.collection(`leagues/${leagueId}/schedule_drafts`);

  // ---- hide or show the LIVE schedule ------------------------------------
  if (action === "set_visibility") {
    // PARTIAL UPDATE, and this is not a nicety. The first version took
    // `hidden` and the notice off whatever the admin page happened to hold in
    // state, so pressing Hide sent an empty notice and WIPED the line the
    // league had set. Kaitlin did exactly that within the hour: her page had
    // been open since before the notice existed, so her state said "".
    //
    // The reverse was just as live: saving the notice sent a stale `hidden`,
    // so writing a line could put a schedule back up mid-rebuild.
    //
    // So each field moves only when it is actually in the request. The hide
    // button sends `hidden`. The notice button sends `releaseNote`. Neither
    // can reach across and undo the other.
    const patch: Record<string, unknown> = { updated_at: now, updated_by: who };
    let touched = false;
    if (typeof body.hidden === "boolean") {
      patch.hidden = body.hidden;
      // A bare "coming soon" makes a league look abandoned. A reason makes it
      // look like somebody is working, which is the truth.
      patch.note = typeof body.note === "string" ? body.note.trim().slice(0, 200) : "";
      touched = true;
    }
    if (typeof body.releaseNote === "string") {
      patch.release_note = body.releaseNote.trim().slice(0, 300);
      touched = true;
    }
    if (!touched) {
      return NextResponse.json(
        { error: "nothing to change: send hidden, releaseNote, or both" },
        { status: 400 },
      );
    }
    const hidden = typeof body.hidden === "boolean" ? body.hidden : undefined;
    await db
      .doc(`leagues/${leagueId}/site_config/schedule`)
      .set(patch, { merge: true });
    if (hidden !== undefined) {
      try {
        await db.collection(`leagues/${leagueId}/audit`).add({
          kind: hidden ? "schedule_hidden" : "schedule_shown",
          by_uid: decoded.uid,
          at: now,
        });
      } catch {
        /* never fail the toggle over the audit row */
      }
    }
    return NextResponse.json({ ok: true, ...(hidden !== undefined ? { hidden } : {}) });
  }

  // ---- list the drafts ----------------------------------------------------
  if (action === "list") {
    const snap = await col.orderBy("created_at", "desc").limit(MAX_DRAFTS).get();
    return NextResponse.json({
      ok: true,
      drafts: snap.docs.map((d) => {
        const v = d.data();
        return {
          id: d.id,
          name: String(v.name ?? "Untitled"),
          games: Array.isArray(v.games) ? v.games.length : 0,
          division: String(v.division ?? ""),
          created_at: String(v.created_at ?? ""),
          created_by: String(v.created_by ?? ""),
        };
      }),
    });
  }

  // ---- load one back into the builder ------------------------------------
  if (action === "load") {
    const id = String(body.id ?? "");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    const doc = await col.doc(id).get();
    if (!doc.exists) {
      return NextResponse.json({ error: "that draft is gone" }, { status: 404 });
    }
    const v = doc.data()!;
    return NextResponse.json({
      ok: true,
      draft: {
        id: doc.id,
        name: String(v.name ?? "Untitled"),
        division: String(v.division ?? ""),
        games: Array.isArray(v.games) ? v.games : [],
        created_at: String(v.created_at ?? ""),
      },
    });
  }

  // ---- save a new draft ---------------------------------------------------
  if (action === "save") {
    const cleaned = cleanGames(body.games);
    if ("error" in cleaned) {
      return NextResponse.json({ error: cleaned.error }, { status: 400 });
    }
    const name =
      (typeof body.name === "string" ? body.name.trim() : "").slice(0, 80) ||
      `Draft ${now.slice(0, 16).replace("T", " ")}`;

    // Keep the list from growing without bound. Oldest goes, and only ever
    // after the new one is safely written.
    const ref = await col.add({
      name,
      division: typeof body.division === "string" ? body.division.trim() : "",
      games: cleaned.games,
      created_at: now,
      created_by: who,
    });
    try {
      const all = await col.orderBy("created_at", "desc").get();
      const extra = all.docs.slice(MAX_DRAFTS);
      for (const d of extra) await d.ref.delete();
    } catch {
      /* trimming is housekeeping, never a reason to fail the save */
    }
    return NextResponse.json({ ok: true, id: ref.id, name, games: cleaned.games.length });
  }

  // ---- throw one away -----------------------------------------------------
  if (action === "delete") {
    const id = String(body.id ?? "");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    await col.doc(id).delete();
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json(
    { error: "action must be save | list | load | delete | set_visibility" },
    { status: 400 },
  );
}
