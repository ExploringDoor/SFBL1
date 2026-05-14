// /api/admin-news — commissioner CRUD for News & Events posts.
//
// Posts live at /leagues/{leagueId}/news/{id}. They surface on the
// homepage "From the Commissioner — News & Events" strip and are
// independent of /content/* pages. A post is either:
//   - announcement: a title + body (HTML) the commissioner wants on
//     the homepage
//   - event: same plus an `event_date` ISO string (lands the calendar
//     icon + date on the public card)
//
// Pin order:
//   - `pinned: true` posts sort first (most-recent created)
//   - then by `event_date` desc (events) / `created_at` desc
//
// Body shape:
//   POST { leagueId, action: "save", id?, title, body, pinned,
//          event_date?, color? }
//   POST { leagueId, action: "delete", id }
//
// Auth: caller must be admin of leagueId.

import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";
import { sanitizeHtml } from "@/lib/markdown";

export const runtime = "nodejs";

interface NewsPayload {
  leagueId?: unknown;
  action?: unknown;
  id?: unknown;
  title?: unknown;
  body?: unknown;
  pinned?: unknown;
  event_date?: unknown;
  color?: unknown;
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
    // checkRevoked=true — news posts are publicly visible. A
    // demoted admin shouldn't keep a window open to publish.
    decoded = await getAdminAuth().verifyIdToken(idToken, true);
  } catch {
    return NextResponse.json(
      { error: "Invalid or expired token" },
      { status: 401 },
    );
  }

  let body: NewsPayload;
  try {
    body = (await req.json()) as NewsPayload;
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
    await db.doc(`leagues/${leagueId}/news/${body.id}`).delete();
    await db.collection(`leagues/${leagueId}/audit`).add({
      kind: "news_delete",
      by_uid: decoded.uid,
      by_role: "admin",
      changes: { id: body.id },
      at: new Date().toISOString(),
    });
    return NextResponse.json({ ok: true });
  }

  if (action === "save") {
    const title =
      typeof body.title === "string" ? body.title.trim() : "";
    const text =
      typeof body.body === "string" ? sanitizeHtml(body.body.trim()) : "";
    if (!title && !text) {
      return NextResponse.json(
        { error: "Need at least a title or body" },
        { status: 400 },
      );
    }
    const pinned = body.pinned === true;
    const event_date =
      typeof body.event_date === "string" && body.event_date
        ? body.event_date
        : null;
    const color =
      typeof body.color === "string" && /^#[0-9a-f]{6}$/i.test(body.color)
        ? body.color
        : null;
    const id =
      typeof body.id === "string" && body.id ? body.id : randomUUID();

    const now = new Date().toISOString();
    const ref = db.doc(`leagues/${leagueId}/news/${id}`);
    const existing = await ref.get();
    const payload = {
      id,
      title,
      body: text,
      pinned,
      event_date,
      color,
      // Preserve the original created_at on edit; only stamp it new
      // when this is a fresh insert.
      created_at: existing.exists
        ? (existing.data()?.created_at ?? now)
        : now,
      updated_at: now,
      updated_by_uid: decoded.uid,
    };
    await ref.set(payload, { merge: true });

    await db.collection(`leagues/${leagueId}/audit`).add({
      kind: existing.exists ? "news_update" : "news_create",
      by_uid: decoded.uid,
      by_role: "admin",
      changes: { id, title, pinned, event_date },
      at: now,
    });

    return NextResponse.json({ ok: true, post: payload });
  }

  return NextResponse.json(
    { error: "action must be save | delete" },
    { status: 400 },
  );
}
