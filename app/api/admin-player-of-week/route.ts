// /api/admin-player-of-week — commissioner CRUD for Player of the
// Week entries.
//
// Entries live at /leagues/{leagueId}/player_of_week/{id}. They
// surface on the public /player-of-the-week page: the most recent
// (by award_date, then created_at) renders as the current spotlight,
// the rest as a dated archive.
//
// Manually curated (Adam, 2026-05-18) — there is no auto-from-stats
// path. The commissioner picks the player, writes a blurb, and
// optionally adds a stat line + photo.
//
// Body shape:
//   POST { leagueId, action: "save", id?, player_name, team_name?,
//          week_label?, award_date?, stat_line?, blurb?, photo_url? }
//   POST { leagueId, action: "delete", id }
//
// Auth: caller must be admin of leagueId. Mirrors /api/admin-news.

import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";
import { sanitizeHtml } from "@/lib/markdown";

export const runtime = "nodejs";

interface PotwPayload {
  leagueId?: unknown;
  action?: unknown;
  id?: unknown;
  player_name?: unknown;
  team_name?: unknown;
  season?: unknown;
  week?: unknown;
  week_label?: unknown;
  award_date?: unknown;
  stat_line?: unknown;
  blurb?: unknown;
  photo_url?: unknown;
}

// Only allow http(s) image URLs — blocks javascript:/data: smuggling
// into the public <img src>.
function cleanUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const v = raw.trim();
  return /^https?:\/\//i.test(v) ? v : null;
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
    // checkRevoked=true — entries are publicly visible; a demoted
    // admin shouldn't keep a window open to publish.
    decoded = await getAdminAuth().verifyIdToken(idToken, true);
  } catch {
    return NextResponse.json(
      { error: "Invalid or expired token" },
      { status: 401 },
    );
  }

  let body: PotwPayload;
  try {
    body = (await req.json()) as PotwPayload;
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

  if (action === "delete") {
    if (typeof body.id !== "string" || !body.id) {
      return NextResponse.json(
        { error: "id required for delete" },
        { status: 400 },
      );
    }
    await db.doc(`leagues/${leagueId}/player_of_week/${body.id}`).delete();
    await db.collection(`leagues/${leagueId}/audit`).add({
      kind: "potw_delete",
      by_uid: decoded.uid,
      by_role: "admin",
      changes: { id: body.id },
      at: new Date().toISOString(),
    });
    return NextResponse.json({ ok: true });
  }

  if (action === "save") {
    const player_name =
      typeof body.player_name === "string" ? body.player_name.trim() : "";
    if (!player_name) {
      return NextResponse.json(
        { error: "player_name is required" },
        { status: 400 },
      );
    }
    const team_name =
      typeof body.team_name === "string" ? body.team_name.trim() : "";
    const season =
      typeof body.season === "string" ? body.season.trim() : "";
    const weekNum =
      typeof body.week === "number"
        ? body.week
        : typeof body.week === "string" && body.week.trim() !== ""
          ? Number(body.week)
          : NaN;
    const week =
      Number.isFinite(weekNum) && weekNum >= 0 ? Math.floor(weekNum) : null;
    const week_label =
      typeof body.week_label === "string" ? body.week_label.trim() : "";
    const award_date =
      typeof body.award_date === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(body.award_date)
        ? body.award_date
        : null;
    const stat_line =
      typeof body.stat_line === "string" ? body.stat_line.trim() : "";
    const blurb =
      typeof body.blurb === "string" ? sanitizeHtml(body.blurb.trim()) : "";
    const photo_url = cleanUrl(body.photo_url);
    const id =
      typeof body.id === "string" && body.id ? body.id : randomUUID();

    const now = new Date().toISOString();
    const ref = db.doc(`leagues/${leagueId}/player_of_week/${id}`);
    const existing = await ref.get();
    const payload = {
      id,
      player_name,
      team_name,
      season,
      week,
      week_label,
      award_date,
      stat_line,
      blurb,
      photo_url,
      // Preserve original created_at on edit; stamp fresh on insert.
      created_at: existing.exists
        ? (existing.data()?.created_at ?? now)
        : now,
      updated_at: now,
      updated_by_uid: decoded.uid,
    };
    await ref.set(payload, { merge: true });

    await db.collection(`leagues/${leagueId}/audit`).add({
      kind: existing.exists ? "potw_update" : "potw_create",
      by_uid: decoded.uid,
      by_role: "admin",
      changes: { id, player_name, season, week, week_label, award_date },
      at: now,
    });

    return NextResponse.json({ ok: true, entry: payload });
  }

  return NextResponse.json(
    { error: "action must be save | delete" },
    { status: 400 },
  );
}
