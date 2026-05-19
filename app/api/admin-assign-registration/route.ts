// /api/admin-assign-registration — turn a public player-registration
// submission into a real roster player.
//
// Admin reviews a player_registration form submission, picks the
// team to put them on, and this endpoint:
//   1. creates a player doc on that team (public: name, jersey,
//      position) mirroring /api/captain-add-player
//   2. writes email / phone / DOB to the player's _private/contact
//      subdoc — DOB is PII and never touches the public player doc
//      or any public surface
//   3. stamps the submission done + records assigned_player_id so a
//      re-click is idempotent (no duplicate players)
//
// Body: { leagueId, submissionId, teamId, jersey? }
// Auth: caller must be admin of leagueId. Pattern mirrors
// /api/admin-form-submission-status.

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";

const SUBMISSION_KIND = "player_registration";

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
    // checkRevoked=true — creating roster players is a high-trust
    // mutation; a demoted admin shouldn't keep a window open.
    decoded = await getAdminAuth().verifyIdToken(idToken, true);
  } catch {
    return NextResponse.json(
      { error: "Invalid or expired token" },
      { status: 401 },
    );
  }

  let body: {
    leagueId?: unknown;
    submissionId?: unknown;
    teamId?: unknown;
    jersey?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const leagueId = body.leagueId;
  const submissionId = body.submissionId;
  const teamId = body.teamId;
  if (typeof leagueId !== "string" || !leagueId) {
    return NextResponse.json(
      { error: "leagueId is required" },
      { status: 400 },
    );
  }
  if (typeof submissionId !== "string" || !submissionId) {
    return NextResponse.json(
      { error: "submissionId is required" },
      { status: 400 },
    );
  }
  if (typeof teamId !== "string" || !teamId) {
    return NextResponse.json(
      { error: "teamId is required (pick the team to assign them to)" },
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

  // Team must exist — fail fast on a typo'd / stale teamId.
  const teamSnap = await db.doc(`leagues/${leagueId}/teams/${teamId}`).get();
  if (!teamSnap.exists) {
    return NextResponse.json(
      { error: `Team "${teamId}" not found in this league` },
      { status: 404 },
    );
  }

  const subRef = db.doc(
    `leagues/${leagueId}/form_submissions/${SUBMISSION_KIND}/items/${submissionId}`,
  );
  const subSnap = await subRef.get();
  if (!subSnap.exists) {
    return NextResponse.json(
      { error: "Registration submission not found" },
      { status: 404 },
    );
  }
  const sub = subSnap.data() ?? {};

  // Idempotency: if this submission was already assigned, return the
  // existing player instead of creating a duplicate.
  if (typeof sub.assigned_player_id === "string" && sub.assigned_player_id) {
    return NextResponse.json({
      ok: true,
      already: true,
      player_id: sub.assigned_player_id,
      team_id: String(sub.assigned_team_id ?? teamId),
    });
  }

  const firstName =
    typeof sub.first_name === "string" ? sub.first_name.trim() : "";
  const lastName =
    typeof sub.last_name === "string" ? sub.last_name.trim() : "";
  const name = `${firstName} ${lastName}`.trim();
  if (!name) {
    return NextResponse.json(
      { error: "Submission has no first/last name to build a player from" },
      { status: 400 },
    );
  }
  const position =
    typeof sub.primary_position === "string"
      ? sub.primary_position.trim()
      : "";
  const email =
    typeof sub.email === "string" ? sub.email.trim().toLowerCase() : "";
  const phone = typeof sub.phone === "string" ? sub.phone.trim() : "";
  const dob = typeof sub.dob === "string" ? sub.dob.trim() : "";
  const jerseyNum =
    body.jersey === "" || body.jersey == null
      ? null
      : Number(body.jersey);

  // Stable slug id from the name with a numeric suffix on collision —
  // identical to /api/captain-add-player so behavior is consistent.
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "player";
  let playerId = slug;
  for (let i = 1; i < 99; i++) {
    const exists = await db
      .doc(`leagues/${leagueId}/players/${playerId}`)
      .get();
    if (!exists.exists) break;
    playerId = `${slug}-${i + 1}`;
  }

  const now = new Date().toISOString();

  // Public doc — never PII. Admin-assigned, so walk_on:false (it's
  // already been vetted via the registration review, no second
  // captain-signup approval needed).
  await db.doc(`leagues/${leagueId}/players/${playerId}`).set({
    name,
    team_id: teamId,
    jersey: Number.isFinite(jerseyNum as number) ? jerseyNum : null,
    ...(position ? { position } : {}),
    walk_on: false,
    source: "registration",
    registration_submission_id: submissionId,
    created_by_uid: decoded.uid,
    created_at: now,
    active: true,
    status: "active",
  });

  // Private contact subdoc — admin/self-readable only
  // (firestore.rules). DOB lives here, never on the public doc.
  if (email || phone || dob) {
    await db
      .doc(`leagues/${leagueId}/players/${playerId}/_private/contact`)
      .set(
        {
          ...(email ? { email } : {}),
          ...(phone ? { phone } : {}),
          ...(dob ? { dob } : {}),
          updated_at: now,
        },
        { merge: true },
      );
  }

  // Mark the submission handled + link the player for idempotency
  // and traceability.
  await subRef.set(
    {
      status: "done",
      assigned_player_id: playerId,
      assigned_team_id: teamId,
      assigned_at: now,
      assigned_by_uid: decoded.uid,
    },
    { merge: true },
  );

  await db.collection(`leagues/${leagueId}/audit`).add({
    kind: "registration_assigned",
    by_uid: decoded.uid,
    by_role: "admin",
    changes: {
      submission_id: submissionId,
      player_id: playerId,
      team_id: teamId,
      name,
    },
    at: now,
  });

  return NextResponse.json({ ok: true, player_id: playerId, team_id: teamId });
}
