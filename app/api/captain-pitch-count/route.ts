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
import { PITCH_RULESETS, rulesetIdForAge } from "@/lib/pitchcount/rulesets";

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

  // Tell the coach immediately if this pitcher is now over the age group's
  // daily cap for that date. We record the outing either way — the log must
  // reflect what actually happened — but a silent accept is how an over-limit
  // day goes unnoticed. Totals are per DAY, so include any earlier outing.
  let warning: string | null = null;
  try {
    const teamSnap = await db.doc(`leagues/${leagueId}/teams/${teamId}`).get();
    const ageGroup = teamSnap.exists ? String(teamSnap.data()?.ageGroup ?? "") : "";
    const rulesetId = ageGroup ? rulesetIdForAge(ageGroup) : null;
    const ruleset = rulesetId ? PITCH_RULESETS[rulesetId] : null;
    if (ruleset) {
      const daySnap = await db
        .collection(`leagues/${leagueId}/pitch_outings`)
        .where("team_id", "==", teamId)
        .where("player_name", "==", playerName)
        .where("date", "==", date)
        .get();
      const dayTotal = daySnap.docs.reduce(
        (sum, d) => sum + (Number(d.data().pitches) || 0),
        0,
      );
      if (dayTotal > ruleset.dailyMax) {
        warning =
          `${playerName} is now at ${dayTotal} pitches for ${date}, over the ` +
          `${ruleset.dailyMax} pitch daily limit for ${ruleset.label}. The entry was saved.`;
      }
    }
  } catch {
    /* the warning is best-effort; never fail a save over it */
  }

  return NextResponse.json({ ok: true, id: ref.id, warning });
}
