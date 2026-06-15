// /api/admin-schedule — admin CRUD for game docs.
//
// Why a dedicated endpoint vs reusing /api/captain-schedule:
//   captain-schedule is captain-of-team scoped and only allows
//   date/field/status mutations. Admins need to:
//     - create new games mid-season (makeup games, additions)
//     - edit any field on any game (home/away team, division, etc.)
//     - delete games (typo/duplicate)
//     - mark a whole DATE as rained out in one action
//
// Body shapes:
//   { leagueId, action: "create", game: {...} } → POST a new game
//   { leagueId, action: "update", gameId, patch: {...} } → patch existing
//   { leagueId, action: "delete", gameId } → hard delete
//   { leagueId, action: "rain_out_day", date: "YYYY-MM-DD" } → mark
//       every scheduled game on that date as postponed, write audit
//       entries, send a single push notification to subscribers.
//
// Auth: caller must be admin of leagueId.
//
// Audit: every mutation appends an entry to /audit so commissioners
// can see what changed.

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";
import {
  fanoutPush,
  originFromRequest,
} from "@/lib/notifications/server-fanout";
import {
  deleteGameEvent,
  gcalAvailable,
  upsertGameEvent,
  type GameForSync,
} from "@/lib/gcal";

export const runtime = "nodejs";

const ALLOWED_STATUS = new Set([
  "scheduled",
  "live",
  "postponed",
  "cancelled",
  // "bye" — both teams are off this week. Paired like the old SFBL
  // site ("Team A vs Team B — BYE"). No score; excluded from standings.
  "bye",
  "final",
  "approved",
]);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{1,2}:\d{2}(:\d{2})?$/;
// Same slug constraint we use for team_id everywhere.
const TEAM_ID_RE = /^[a-z0-9_-]+$/;

interface GameInput {
  date?: string;
  time?: string;
  field?: string;
  away_team_id?: string;
  home_team_id?: string;
  division?: string;
  week?: string | number | null;
  status?: string;
  away_score?: number | null;
  home_score?: number | null;
}

export async function POST(req: Request) {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return NextResponse.json(
      { error: "Missing bearer token" },
      { status: 401 },
    );
  }
  const idToken = auth.slice("Bearer ".length).trim();

  let decoded;
  try {
    decoded = await getAdminAuth().verifyIdToken(idToken);
  } catch {
    return NextResponse.json(
      { error: "Invalid or expired token" },
      { status: 401 },
    );
  }

  let body: {
    leagueId?: unknown;
    action?: unknown;
    gameId?: unknown;
    game?: unknown;
    patch?: unknown;
    date?: unknown;
    notify?: unknown;
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

  const callerLeagues = decoded.leagues as
    | Record<string, string>
    | undefined;
  if (callerLeagues?.[leagueId] !== "admin") {
    return NextResponse.json(
      { error: `Not admin of league "${leagueId}"` },
      { status: 403 },
    );
  }

  const db = getAdminDb();
  const action = body.action;

  if (action === "create") {
    const game = body.game as GameInput | undefined;
    if (!game || typeof game !== "object") {
      return NextResponse.json(
        { error: "create requires a `game` object" },
        { status: 400 },
      );
    }
    const validation = validateGame(game, { isUpdate: false });
    if (validation.error) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    // Generate a unique id. Format `g-NNNN` to match the seeded data.
    // Find max existing numeric suffix and add 1.
    const snap = await db.collection(`leagues/${leagueId}/games`).get();
    let maxNum = 0;
    for (const d of snap.docs) {
      const m = d.id.match(/^g-(\d+)$/);
      if (m) {
        const n = parseInt(m[1]!, 10);
        if (n > maxNum) maxNum = n;
      }
    }
    const newId = `g-${String(maxNum + 1).padStart(4, "0")}`;

    const doc = sanitizeGame(game, { isUpdate: false });
    await db.doc(`leagues/${leagueId}/games/${newId}`).set(doc);
    await writeAudit(db, leagueId, decoded.uid, "schedule_create", newId, doc);
    await syncGcalForGame(db, leagueId, newId, doc);
    return NextResponse.json({ ok: true, gameId: newId, game: doc });
  }

  if (action === "update") {
    const gameId = body.gameId;
    const patch = body.patch as GameInput | undefined;
    if (typeof gameId !== "string" || !gameId) {
      return NextResponse.json(
        { error: "update requires `gameId`" },
        { status: 400 },
      );
    }
    if (!patch || typeof patch !== "object") {
      return NextResponse.json(
        { error: "update requires a `patch` object" },
        { status: 400 },
      );
    }
    const validation = validateGame(patch, { isUpdate: true });
    if (validation.error) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
    const cleaned = sanitizeGame(patch, { isUpdate: true });
    if (Object.keys(cleaned).length === 0) {
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 },
      );
    }
    const ref = db.doc(`leagues/${leagueId}/games/${gameId}`);
    const before = await ref.get();
    if (!before.exists) {
      return NextResponse.json({ error: "Game not found" }, { status: 404 });
    }
    await ref.set(cleaned, { merge: true });
    await writeAudit(
      db,
      leagueId,
      decoded.uid,
      "schedule_edit",
      gameId,
      cleaned,
    );
    // Re-fetch merged doc for GCal sync (so we get fields the patch
    // didn't touch, like the existing gcal_event_id).
    const merged = await ref.get();
    await syncGcalForGame(db, leagueId, gameId, merged.data() ?? {});
    return NextResponse.json({ ok: true, gameId, patch: cleaned });
  }

  if (action === "delete") {
    const gameId = body.gameId;
    if (typeof gameId !== "string" || !gameId) {
      return NextResponse.json(
        { error: "delete requires `gameId`" },
        { status: 400 },
      );
    }
    const ref = db.doc(`leagues/${leagueId}/games/${gameId}`);
    const before = await ref.get();
    if (!before.exists) {
      return NextResponse.json({ error: "Game not found" }, { status: 404 });
    }
    const beforeData = before.data() ?? {};
    await ref.delete();
    await writeAudit(db, leagueId, decoded.uid, "schedule_delete", gameId, {
      deleted: beforeData,
    });
    // Mirror the delete to GCal if we have an event id.
    if (typeof beforeData.gcal_event_id === "string") {
      await deleteGcalEvent(db, leagueId, beforeData.gcal_event_id);
    }
    return NextResponse.json({ ok: true, gameId });
  }

  if (action === "rain_out_day") {
    const date = body.date;
    if (typeof date !== "string" || !DATE_RE.test(date)) {
      return NextResponse.json(
        { error: "rain_out_day requires `date` as YYYY-MM-DD" },
        { status: 400 },
      );
    }
    // Find every game on that date that's still scheduled (don't
    // touch finals/cancelled — those are intentional terminal states).
    const snap = await db
      .collection(`leagues/${leagueId}/games`)
      .where("date", "==", date)
      .get();
    const targets = snap.docs.filter((d) => {
      const s = String(d.data().status ?? "scheduled");
      return s === "scheduled";
    });
    if (targets.length === 0) {
      return NextResponse.json({
        ok: true,
        date,
        affected: 0,
        message: "No scheduled games on that date.",
      });
    }
    const batch = db.batch();
    for (const d of targets) {
      batch.set(
        d.ref,
        { status: "postponed", rained_out_at: new Date().toISOString() },
        { merge: true },
      );
    }
    await batch.commit();
    await writeAudit(
      db,
      leagueId,
      decoded.uid,
      "rain_out_day",
      null,
      { date, affected_game_ids: targets.map((d) => d.id) },
    );
    // Mirror to GCal: each affected event flips to status=cancelled.
    // Best-effort — don't block the rain-out if GCal hiccups.
    for (const d of targets) {
      const merged = await d.ref.get();
      await syncGcalForGame(db, leagueId, d.id, merged.data() ?? {});
    }

    // Single push (not one-per-game) so subscribers don't get spammed.
    let pushSent = false;
    if (body.notify !== false) {
      try {
        await fanoutPush({
          origin: originFromRequest(req),
          bearerToken: idToken,
          leagueId,
          category: "rainouts",
          title: "🌧 Rain out — games postponed",
          body: `All ${targets.length} games on ${formatDateForPush(date)} are postponed. Make-up dates TBD.`,
          url: "/schedule",
        });
        pushSent = true;
      } catch (e) {
        // Best-effort — don't fail the rain out if push fails.
        console.warn("[admin-schedule] rain_out push failed:", e);
      }
    }

    return NextResponse.json({
      ok: true,
      date,
      affected: targets.length,
      affected_game_ids: targets.map((d) => d.id),
      push_sent: pushSent,
    });
  }

  return NextResponse.json(
    { error: "action must be create | update | delete | rain_out_day" },
    { status: 400 },
  );
}

// ─── helpers ──────────────────────────────────────────────────────

function validateGame(
  g: GameInput,
  { isUpdate }: { isUpdate: boolean },
): { error: string | null } {
  // For create, require date + away_team_id + home_team_id at minimum.
  if (!isUpdate) {
    if (!g.date || typeof g.date !== "string" || !DATE_RE.test(g.date)) {
      return { error: "date is required (YYYY-MM-DD)" };
    }
    if (
      !g.away_team_id ||
      typeof g.away_team_id !== "string" ||
      !TEAM_ID_RE.test(g.away_team_id)
    ) {
      return { error: "away_team_id is required" };
    }
    if (
      !g.home_team_id ||
      typeof g.home_team_id !== "string" ||
      !TEAM_ID_RE.test(g.home_team_id)
    ) {
      return { error: "home_team_id is required" };
    }
    if (g.away_team_id === g.home_team_id) {
      return { error: "Home and away teams must differ" };
    }
  }
  if (g.date != null && g.date !== "" && !DATE_RE.test(String(g.date))) {
    return { error: "date must be YYYY-MM-DD" };
  }
  if (g.time != null && g.time !== "" && !TIME_RE.test(String(g.time))) {
    return { error: "time must be HH:MM" };
  }
  if (
    g.away_team_id != null &&
    g.away_team_id !== "" &&
    !TEAM_ID_RE.test(String(g.away_team_id))
  ) {
    return { error: "away_team_id has invalid characters" };
  }
  if (
    g.home_team_id != null &&
    g.home_team_id !== "" &&
    !TEAM_ID_RE.test(String(g.home_team_id))
  ) {
    return { error: "home_team_id has invalid characters" };
  }
  if (g.status != null && !ALLOWED_STATUS.has(String(g.status))) {
    return {
      error: `status must be one of ${[...ALLOWED_STATUS].join(", ")}`,
    };
  }
  return { error: null };
}

function sanitizeGame(
  g: GameInput,
  { isUpdate }: { isUpdate: boolean },
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (g.date != null) out.date = String(g.date);
  if (g.time != null) out.time = String(g.time);
  if (g.field != null) out.field = String(g.field).trim();
  if (g.away_team_id != null) out.away_team_id = String(g.away_team_id);
  if (g.home_team_id != null) out.home_team_id = String(g.home_team_id);
  if (g.division != null) out.division = String(g.division).trim();
  if (g.week != null) out.week = g.week === "" ? null : g.week;
  if (g.status != null) out.status = String(g.status);
  if (g.away_score != null && g.away_score !== ("" as never)) {
    out.away_score = Number(g.away_score);
  }
  if (g.home_score != null && g.home_score !== ("" as never)) {
    out.home_score = Number(g.home_score);
  }
  // For new games, default status to "scheduled" if not set.
  if (!isUpdate && out.status == null) out.status = "scheduled";
  return out;
}

async function writeAudit(
  db: FirebaseFirestore.Firestore,
  leagueId: string,
  byUid: string,
  kind: string,
  gameId: string | null,
  changes: Record<string, unknown>,
): Promise<void> {
  await db.collection(`leagues/${leagueId}/audit`).add({
    kind,
    by_uid: byUid,
    by_role: "admin",
    game_id: gameId,
    changes,
    at: new Date().toISOString(),
  });
}

function formatDateForPush(yyyymmdd: string): string {
  // "2026-05-03" → "May 3"
  const [, m, d] = yyyymmdd.split("-");
  const monthName = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ][parseInt(m ?? "1", 10) - 1];
  return `${monthName} ${parseInt(d ?? "1", 10)}`;
}

// ─── Google Calendar sync ─────────────────────────────────────────
// Best-effort: a failed sync doesn't break the schedule mutation.
// Source-of-truth is Firestore; the calendar is a downstream
// projection. Admin can hit "Sync now" in the Calendar tab to
// reconcile if drift accumulates.

async function syncGcalForGame(
  db: FirebaseFirestore.Firestore,
  leagueId: string,
  gameId: string,
  data: FirebaseFirestore.DocumentData,
): Promise<void> {
  if (!gcalAvailable()) return;
  const cfg = (
    await db.doc(`leagues/${leagueId}/site_config/gcal`).get()
  ).data();
  if (!cfg?.enabled || !cfg.calendar_id) return;
  const calendarId = String(cfg.calendar_id);
  const timeZone = String(cfg.time_zone ?? "America/New_York");

  try {
    // Build display names (events should show "Marlins @ Yankees" not
    // raw team_ids).
    const teamSnap = await db.collection(`leagues/${leagueId}/teams`).get();
    const teamName = new Map<string, string>();
    for (const d of teamSnap.docs)
      teamName.set(d.id, String(d.data().name ?? d.id));

    // Same date/time normalization as ScheduleEditor: handles both
    // combined-ISO and split-string shapes from the data layer.
    const dateRaw = String(data.date ?? "");
    const timeRaw = String(data.time ?? "");
    let date = dateRaw.slice(0, 10);
    let time = timeRaw;
    if (!/^\d{1,2}:\d{2}$/.test(time)) {
      const dt = new Date(dateRaw);
      if (!Number.isNaN(dt.getTime())) {
        date = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
        time = `${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`;
      }
    }
    const game: GameForSync = {
      id: gameId,
      date,
      time,
      field: String(data.field ?? ""),
      away_team_name:
        teamName.get(String(data.away_team_id ?? "")) ??
        String(data.away_team_id ?? ""),
      home_team_name:
        teamName.get(String(data.home_team_id ?? "")) ??
        String(data.home_team_id ?? ""),
      division: String(data.division ?? ""),
      status: String(data.status ?? "scheduled"),
      gcal_event_id: data.gcal_event_id
        ? String(data.gcal_event_id)
        : undefined,
    };
    const eventId = await upsertGameEvent(calendarId, game, timeZone);
    if (eventId !== game.gcal_event_id) {
      await db
        .doc(`leagues/${leagueId}/games/${gameId}`)
        .set({ gcal_event_id: eventId }, { merge: true });
    }
  } catch (e) {
    console.warn(
      `[gcal] sync failed for game ${gameId}:`,
      e instanceof Error ? e.message : e,
    );
  }
}

async function deleteGcalEvent(
  db: FirebaseFirestore.Firestore,
  leagueId: string,
  eventId: string,
): Promise<void> {
  if (!gcalAvailable()) return;
  const cfg = (
    await db.doc(`leagues/${leagueId}/site_config/gcal`).get()
  ).data();
  if (!cfg?.enabled || !cfg.calendar_id) return;
  try {
    await deleteGameEvent(String(cfg.calendar_id), eventId);
  } catch (e) {
    console.warn(
      `[gcal] delete failed for event ${eventId}:`,
      e instanceof Error ? e.message : e,
    );
  }
}
