// POST /api/admin-tournament-logo — the office sets or clears a tournament's
// logo without waiting for a deploy.
//
// Body: { leagueId, slug, name, logo }        logo = "data:image/…;base64,…"
//       { leagueId, slug, clear: true }       fall back to the checked-in art
//
// Admin-only. Same shape and the same storage trick as /api/captain-team-logo:
// a client-resized data URL on a Firestore doc, so there is no Storage bucket
// to provision and no bucket rules to get wrong.

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";

// ~700KB of data URL. The client resizes to 500px and encodes JPEG, which
// lands around 60-120KB, so this is a generous ceiling that still keeps the
// document comfortably inside Firestore's 1MB limit. Refused rather than
// truncated: a half-written image is worse than a rejected one.
const MAX_LOGO_BYTES = 700_000;

export async function POST(req: Request) {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });
  }
  let decoded;
  try {
    decoded = await getAdminAuth().verifyIdToken(
      auth.slice("Bearer ".length).trim(),
    );
  } catch {
    return NextResponse.json(
      { error: "Invalid or expired token" },
      { status: 401 },
    );
  }

  let body: {
    leagueId?: unknown;
    slug?: unknown;
    name?: unknown;
    logo?: unknown;
    clear?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const leagueId = body.leagueId;
  if (typeof leagueId !== "string" || !/^[a-z0-9_-]+$/.test(leagueId)) {
    return NextResponse.json({ error: "leagueId required" }, { status: 400 });
  }
  // The slug becomes a Firestore document id, so it is constrained rather
  // than trusted.
  const slug = body.slug;
  if (typeof slug !== "string" || !/^[a-z0-9-]{1,80}$/.test(slug)) {
    return NextResponse.json({ error: "slug required" }, { status: 400 });
  }

  const leagues = decoded.leagues as Record<string, string> | undefined;
  if (leagues?.[leagueId] !== "admin") {
    return NextResponse.json(
      { error: `Not admin of league "${leagueId}"` },
      { status: 403 },
    );
  }

  const ref = getAdminDb().doc(`leagues/${leagueId}/tournament_logos/${slug}`);

  if (body.clear === true) {
    await ref.delete().catch(() => {});
    return NextResponse.json({ ok: true, cleared: true });
  }

  const logo = body.logo;
  if (typeof logo !== "string" || !logo.startsWith("data:image/")) {
    return NextResponse.json(
      { error: "logo must be an image data URL" },
      { status: 400 },
    );
  }
  if (logo.length > MAX_LOGO_BYTES) {
    return NextResponse.json(
      {
        error: `That image is too large even after resizing (${Math.round(
          logo.length / 1024,
        )}KB). Try a smaller file.`,
      },
      { status: 413 },
    );
  }

  await ref.set(
    {
      logo,
      // The display name is stored alongside purely so the collection is
      // readable in the Firestore console; nothing renders from it.
      name: typeof body.name === "string" ? body.name : slug,
      updated_at: new Date().toISOString(),
      updated_by_uid: decoded.uid,
    },
    { merge: true },
  );

  return NextResponse.json({ ok: true });
}
