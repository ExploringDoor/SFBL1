// POST /api/captain-team-logo — a captain (or admin) sets their team's logo.
//
// The captain uploads an image; the client resizes it to a 512×512 PNG and
// sends the base64. We store it in leagues/{leagueId}/team_logos/{teamId}
// (Admin-SDK-only — never client-readable/writable; served publicly via
// GET /api/team-logo) and point the team doc's logo_url at that route.
//
// Storage-free on purpose: Firebase Storage isn't enabled on this project,
// and the same base64 approach the scoresheet upload uses works here. The
// bytes live in their own doc, NOT on the team doc, so the cached
// teams-collection reads stay lean.
//
// AUTH — mirrors /api/captain-payment: a captain is scoped to their OWN
// team (target derived from the `captain:<teamId>` claim; any teamId in the
// body is ignored). An admin may target any team via body.teamId. This is
// the whole security model — a captain can never touch another team's logo.

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  leagueId?: unknown;
  teamId?: unknown;
  pngBase64?: unknown;
}

// Per-uid rate limit — logo changes are rare, so a tight cap is plenty and
// stops a stolen token from hammering Firestore writes. In-memory per warm
// process (same pragmatic approach as parse-boxscore's OCR limiter).
const RATE_LIMIT = 12;
const WINDOW_MS = 10 * 60_000;
const rate = new Map<string, { count: number; reset: number }>();

// A 512×512 PNG is ~300–500KB of base64. Cap generously but finitely so a
// caller can't park megabytes in a doc (Firestore's hard limit is ~1MB).
const MAX_BASE64_LEN = 900_000;
const PNG_MAGIC = "iVBORw0KGgo"; // base64 of the PNG signature bytes

export async function POST(req: Request) {
  const authHdr = req.headers.get("authorization");
  if (!authHdr?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });
  }
  const idToken = authHdr.slice("Bearer ".length).trim();

  let decoded;
  try {
    decoded = await getAdminAuth().verifyIdToken(idToken, true);
  } catch {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const leagueId = body.leagueId;
  if (typeof leagueId !== "string" || !leagueId) {
    return NextResponse.json({ error: "leagueId is required" }, { status: 400 });
  }

  const claim = (decoded.leagues as Record<string, string> | undefined)?.[
    leagueId
  ];
  // Derive the team the caller is allowed to write. Captain → own team from
  // the claim (body.teamId ignored). Admin → body.teamId. Else denied.
  let targetTeamId: string | null = null;
  if (claim === "admin") {
    if (typeof body.teamId === "string" && body.teamId) {
      targetTeamId = body.teamId;
    } else {
      return NextResponse.json(
        { error: "Admin must include { teamId }" },
        { status: 400 },
      );
    }
  } else if (typeof claim === "string" && claim.startsWith("captain:")) {
    targetTeamId = claim.slice("captain:".length) || null;
  }
  if (!targetTeamId) {
    return NextResponse.json(
      { error: "Captain or admin claim required for this league" },
      { status: 403 },
    );
  }

  // Rate limit per uid.
  const now = Date.now();
  const entry = rate.get(decoded.uid);
  if (entry && now < entry.reset) {
    if (entry.count >= RATE_LIMIT) {
      return NextResponse.json(
        { error: "Too many logo updates. Wait a few minutes and try again." },
        { status: 429 },
      );
    }
    entry.count += 1;
  } else {
    rate.set(decoded.uid, { count: 1, reset: now + WINDOW_MS });
  }

  // Validate the payload is a reasonably-sized PNG.
  const pngBase64 = body.pngBase64;
  if (typeof pngBase64 !== "string" || !pngBase64) {
    return NextResponse.json({ error: "pngBase64 is required" }, { status: 400 });
  }
  if (pngBase64.length > MAX_BASE64_LEN) {
    return NextResponse.json(
      { error: "Image is too large after resizing — please try another file." },
      { status: 413 },
    );
  }
  if (!pngBase64.startsWith(PNG_MAGIC)) {
    return NextResponse.json(
      { error: "Expected a PNG image." },
      { status: 400 },
    );
  }

  const db = getAdminDb();

  // The team must exist (and, implicitly, be in this league). Prevents
  // creating a logo for a bogus team id.
  const teamRef = db.doc(`leagues/${leagueId}/teams/${targetTeamId}`);
  const teamSnap = await teamRef.get();
  if (!teamSnap.exists) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }

  const stamp = now;
  await db.doc(`leagues/${leagueId}/team_logos/${targetTeamId}`).set({
    png_base64: pngBase64,
    content_type: "image/png",
    updated_at: new Date(stamp).toISOString(),
    updated_by_uid: decoded.uid,
  });

  // Point the (public) team doc at the serving route. The `v` cache-buster
  // makes a fresh upload bypass any CDN/next-image cache immediately.
  const logoUrl = `/api/team-logo?league=${encodeURIComponent(
    leagueId,
  )}&team=${encodeURIComponent(targetTeamId)}&v=${stamp}`;
  await teamRef.set(
    {
      logo_url: logoUrl,
      updated_at: new Date(stamp).toISOString(),
      updated_by_uid: decoded.uid,
    },
    { merge: true },
  );

  return NextResponse.json({ ok: true, logoUrl });
}
