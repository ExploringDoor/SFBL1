// POST /api/captain-pitch-count — a captain logs (or deletes) a pitcher's
// pitch count for their team. COYBL is stats-off (no player roster), so the
// pitcher is a free-text name. Writes to /leagues/{leagueId}/pitch_outings/{id};
// the public eligibility tracker reads these to compute Pitch Smart rest.
//
// Team scope comes from the captain's claim (captain:<teamId>); admins must
// pass { teamId }. Same auth shape as /api/captain-payment. Writes go through
// here (Admin SDK) so clients never write /pitch_outings directly.

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";

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
    player_name?: unknown;
    date?: unknown;
    pitches?: unknown;
    id?: unknown; // present => delete that outing
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

  // Resolve the captain's team from their claim (admins pass teamId).
  const leagues = decoded.leagues as Record<string, string> | undefined;
  const claim = leagues?.[leagueId];
  let teamId: string;
  if (claim === "admin") {
    if (typeof body.teamId !== "string" || !body.teamId) {
      return NextResponse.json({ error: "Admin must include { teamId } in body" }, { status: 400 });
    }
    teamId = body.teamId;
  } else if (typeof claim === "string" && claim.startsWith("captain:")) {
    teamId = claim.slice("captain:".length);
  } else {
    return NextResponse.json({ error: `Not admin/captain of league "${leagueId}"` }, { status: 403 });
  }

  const db = getAdminDb();

  // Delete path — only an outing belonging to the captain's team.
  if (typeof body.id === "string" && body.id) {
    const ref = db.doc(`leagues/${leagueId}/pitch_outings/${body.id}`);
    const snap = await ref.get();
    if (snap.exists && snap.data()?.team_id !== teamId) {
      return NextResponse.json({ error: "Not your team's entry" }, { status: 403 });
    }
    await ref.delete();
    return NextResponse.json({ ok: true, deleted: body.id });
  }

  // Create path — validate.
  const playerName =
    typeof body.player_name === "string" ? body.player_name.trim() : "";
  const date = typeof body.date === "string" ? body.date.trim() : "";
  const pitches =
    typeof body.pitches === "number" ? body.pitches : Number(body.pitches);
  if (!playerName) {
    return NextResponse.json({ error: "player_name required" }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  }
  if (!Number.isFinite(pitches) || pitches < 0 || pitches > 300) {
    return NextResponse.json({ error: "pitches must be a number 0–300" }, { status: 400 });
  }

  const ref = await db.collection(`leagues/${leagueId}/pitch_outings`).add({
    team_id: teamId,
    player_name: playerName,
    date,
    pitches: Math.round(pitches),
    updated_at: new Date().toISOString(),
    created_by_uid: decoded.uid,
  });
  return NextResponse.json({ ok: true, id: ref.id });
}
