// /api/admin-photo — admin manages the league photo gallery.
//
// POST { action: "upload", imageDataUrl, caption?, taken_at? }
//   Adds a new photo. imageDataUrl is the base64-encoded image
//   from the file picker. Capped at 1.5 MB pre-encode.
//
// POST { action: "delete", photoId }
//   Hard-deletes a gallery item.
//
// POST { action: "update", photoId, caption?, hidden? }
//   Edit a caption or hide/unhide a photo.
//
// Auth: caller must be admin of leagueId.

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";

const MAX_DATA_URL = 2_200_000; // ~1.5 MB original after base64 inflate

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

  let body: {
    leagueId?: unknown;
    action?: unknown;
    imageDataUrl?: unknown;
    caption?: unknown;
    taken_at?: unknown;
    photoId?: unknown;
    hidden?: unknown;
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

  if (action === "upload") {
    if (
      typeof body.imageDataUrl !== "string" ||
      !body.imageDataUrl.startsWith("data:image/")
    ) {
      return NextResponse.json(
        { error: "imageDataUrl must be a data:image/* URL" },
        { status: 400 },
      );
    }
    if (body.imageDataUrl.length > MAX_DATA_URL) {
      return NextResponse.json(
        {
          error: `Image is ${Math.round(body.imageDataUrl.length / 1024)} KB after encoding — keep originals under 1.5 MB.`,
        },
        { status: 413 },
      );
    }
    const ref = db.collection(`leagues/${leagueId}/photos`).doc();
    const data = {
      image_data_url: body.imageDataUrl,
      caption:
        typeof body.caption === "string" ? body.caption.trim() : "",
      taken_at:
        typeof body.taken_at === "string" && body.taken_at
          ? body.taken_at
          : null,
      uploaded_at: new Date().toISOString(),
      uploaded_by_uid: decoded.uid,
      hidden: false,
    };
    await ref.set(data);
    return NextResponse.json({ ok: true, photoId: ref.id });
  }

  if (action === "delete") {
    if (typeof body.photoId !== "string") {
      return NextResponse.json(
        { error: "photoId is required" },
        { status: 400 },
      );
    }
    await db
      .doc(`leagues/${leagueId}/photos/${body.photoId}`)
      .delete();
    return NextResponse.json({ ok: true });
  }

  if (action === "update") {
    if (typeof body.photoId !== "string") {
      return NextResponse.json(
        { error: "photoId is required" },
        { status: 400 },
      );
    }
    const patch: Record<string, unknown> = {};
    if (typeof body.caption === "string") patch.caption = body.caption.trim();
    if (typeof body.hidden === "boolean") patch.hidden = body.hidden;
    if (Object.keys(patch).length === 0) {
      return NextResponse.json(
        { error: "No fields to update" },
        { status: 400 },
      );
    }
    patch.updated_at = new Date().toISOString();
    await db
      .doc(`leagues/${leagueId}/photos/${body.photoId}`)
      .set(patch, { merge: true });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json(
    { error: "action must be upload | update | delete" },
    { status: 400 },
  );
}
