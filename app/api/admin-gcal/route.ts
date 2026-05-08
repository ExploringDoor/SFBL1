// /api/admin-gcal — admin manages Google Calendar sync for the league.
//
// Actions:
//   POST { action: "setup" }
//     Creates a new public-read calendar, stores its id on
//     /leagues/{id}/site_config/gcal. One-time per league.
//
//   POST { action: "sync_all" }
//     Full reconcile — walks every game and upserts a Calendar event.
//     Use to recover from drift, or after enabling sync mid-season.
//
//   POST { action: "disable" }
//     Sets enabled=false on the gcal config. Stops auto-syncing on
//     schedule mutations. Doesn't delete the calendar — admins can
//     re-enable later.
//
// Auth: caller must be admin of leagueId.

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";
import {
  deleteGameEvent,
  gcalAvailable,
  setupLeagueCalendar,
  upsertGameEvent,
  type GameForSync,
} from "@/lib/gcal";

export const runtime = "nodejs";

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
    decoded = await getAdminAuth().verifyIdToken(idToken);
  } catch {
    return NextResponse.json(
      { error: "Invalid or expired token" },
      { status: 401 },
    );
  }

  let body: { leagueId?: unknown; action?: unknown; timeZone?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const leagueId = body.leagueId;
  const action = body.action;
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

  if (!gcalAvailable()) {
    return NextResponse.json(
      {
        error:
          "Google Calendar API isn't configured for this environment. " +
          "Make sure FIREBASE_SERVICE_ACCOUNT_PATH points at a service " +
          "account JSON, and that the Google Calendar API is enabled in " +
          "your Google Cloud project.",
      },
      { status: 501 },
    );
  }

  const db = getAdminDb();
  const cfgRef = db.doc(`leagues/${leagueId}/site_config/gcal`);
  const leagueDoc = await db.doc(`leagues/${leagueId}`).get();
  const leagueName = String(leagueDoc.data()?.name ?? leagueId);
  const timeZone =
    typeof body.timeZone === "string" && body.timeZone
      ? body.timeZone
      : String(leagueDoc.data()?.timezone ?? "America/New_York");

  if (action === "setup") {
    const existing = await cfgRef.get();
    if (existing.exists && existing.data()?.calendar_id) {
      return NextResponse.json({
        ok: true,
        already_setup: true,
        calendar_id: existing.data()!.calendar_id,
        public_url: existing.data()!.public_url,
      });
    }
    try {
      const { calendarId, publicUrl } = await setupLeagueCalendar(
        leagueName,
        timeZone,
      );
      await cfgRef.set({
        enabled: true,
        calendar_id: calendarId,
        public_url: publicUrl,
        time_zone: timeZone,
        created_at: new Date().toISOString(),
        created_by_uid: decoded.uid,
      });
      await db.collection(`leagues/${leagueId}/audit`).add({
        kind: "gcal_setup",
        by_uid: decoded.uid,
        by_role: "admin",
        changes: { calendar_id: calendarId },
        at: new Date().toISOString(),
      });
      return NextResponse.json({
        ok: true,
        calendar_id: calendarId,
        public_url: publicUrl,
      });
    } catch (e) {
      return NextResponse.json(
        {
          error:
            "Calendar create failed: " +
            (e instanceof Error ? e.message : "unknown") +
            ". Verify Google Calendar API is enabled in your GCP project.",
        },
        { status: 500 },
      );
    }
  }

  if (action === "disable") {
    await cfgRef.set({ enabled: false }, { merge: true });
    await db.collection(`leagues/${leagueId}/audit`).add({
      kind: "gcal_disable",
      by_uid: decoded.uid,
      by_role: "admin",
      changes: {},
      at: new Date().toISOString(),
    });
    return NextResponse.json({ ok: true, enabled: false });
  }

  if (action === "sync_all") {
    const cfg = (await cfgRef.get()).data();
    if (!cfg?.calendar_id) {
      return NextResponse.json(
        { error: "Run setup first." },
        { status: 400 },
      );
    }
    const calendarId = String(cfg.calendar_id);
    const [gameSnap, teamSnap] = await Promise.all([
      db.collection(`leagues/${leagueId}/games`).get(),
      db.collection(`leagues/${leagueId}/teams`).get(),
    ]);
    const teamName = new Map<string, string>();
    for (const d of teamSnap.docs)
      teamName.set(d.id, String(d.data().name ?? d.id));

    let synced = 0;
    let failed = 0;
    for (const d of gameSnap.docs) {
      const data = d.data();
      const status = String(data.status ?? "scheduled");
      if (status === "draft" || status === "rained_out") continue;
      try {
        const dateRaw = String(data.date ?? "");
        const timeRaw = String(data.time ?? "");
        // splitDateTime equivalent — parse ISO datetime if combined.
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
          id: d.id,
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
          status,
          gcal_event_id: data.gcal_event_id
            ? String(data.gcal_event_id)
            : undefined,
        };
        const eventId = await upsertGameEvent(
          calendarId,
          game,
          String(cfg.time_zone ?? "America/New_York"),
        );
        if (eventId !== game.gcal_event_id) {
          await d.ref.set({ gcal_event_id: eventId }, { merge: true });
        }
        synced++;
      } catch (e) {
        failed++;
        console.warn(
          `[gcal] sync_all failed for ${d.id}:`,
          e instanceof Error ? e.message : e,
        );
      }
    }

    await cfgRef.set(
      { last_synced_at: new Date().toISOString() },
      { merge: true },
    );
    await db.collection(`leagues/${leagueId}/audit`).add({
      kind: "gcal_sync_all",
      by_uid: decoded.uid,
      by_role: "admin",
      changes: { synced, failed },
      at: new Date().toISOString(),
    });

    return NextResponse.json({ ok: true, synced, failed });
  }

  return NextResponse.json(
    { error: "action must be setup | disable | sync_all" },
    { status: 400 },
  );
}
