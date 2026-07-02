// POST /api/captain-team-logo — a captain sets (or clears) their team's logo
// from the coach portal. The logo is a client-resized PNG data URL stored on
// the team doc's `logo_url` (no Storage bucket needed); TeamBadge renders it
// everywhere the team shows. Team scope comes from the captain's claim
// (captain:<teamId>); admins pass { teamId }. Same auth shape as
// /api/captain-pitch-count.
//
// Body: { leagueId, teamId?, logo }  — logo = "data:image/...;base64,…"
//       { leagueId, teamId?, clear: true }  — remove the logo

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";

// ~400KB cap on the data URL. The client resizes to ≤320px (~40-60KB), so this
// is a generous ceiling that still keeps the team doc well under Firestore's
// 1MB limit.
const MAX_LOGO_BYTES = 400_000;

export async function POST(req: Request) {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });
  }
  const idToken = auth.slice("Bearer ".length).trim();

  let decoded;
  try {
    decoded = await getAdminAuth().verifyIdToken(idToken);
  } catch {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }

  let body: {
    leagueId?: unknown;
    teamId?: unknown;
    logo?: unknown;
    clear?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const leagueId = body.leagueId;
  if (typeof leagueId !== "string" || !leagueId) {
    return NextResponse.json({ error: "Body must include { leagueId }" }, { status: 400 });
  }

  const leagues = decoded.leagues as Record<string, string> | undefined;
  const claim = leagues?.[leagueId];
  let teamId: string;
  if (claim === "admin") {
    if (typeof body.teamId !== "string" || !body.teamId) {
      return NextResponse.json({ error: "Admin must include { teamId }" }, { status: 400 });
    }
    teamId = body.teamId;
  } else if (typeof claim === "string" && claim.startsWith("captain:")) {
    teamId = claim.slice("captain:".length);
  } else {
    return NextResponse.json(
      { error: `Not admin/captain of league "${leagueId}"` },
      { status: 403 },
    );
  }

  const db = getAdminDb();
  const ref = db.doc(`leagues/${leagueId}/teams/${teamId}`);
  const snap = await ref.get();
  if (!snap.exists) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }

  if (body.clear === true) {
    await ref.set({ logo_url: null }, { merge: true });
    return NextResponse.json({ ok: true, cleared: true });
  }

  const logo = body.logo;
  if (typeof logo !== "string" || !logo.startsWith("data:image/")) {
    return NextResponse.json(
      { error: "logo must be an image data URL (or pass clear: true)" },
      { status: 400 },
    );
  }
  if (logo.length > MAX_LOGO_BYTES) {
    return NextResponse.json(
      { error: "Logo is too large — please use a smaller image." },
      { status: 413 },
    );
  }

  await ref.set({ logo_url: logo }, { merge: true });
  return NextResponse.json({ ok: true });
}
