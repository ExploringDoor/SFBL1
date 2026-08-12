// POST /api/admin-provision-team — turn a team registration into a real team.
//
// Body: { leagueId, submissionId } → { ok, teamId, created, teamCode }
//
// COYBL provisions a team automatically the moment a coach registers, so its
// office never needs this. Island does not: Mike reads each signup and decides.
// Until now there was no way to act on that decision. The admin panel's own
// message said "No team was created for this registration, so there is nothing
// to assign yet. Create it on the Teams tab" — and a team typed in by hand on
// the Teams tab is not connected to the registration at all, so:
//   • the coach never gets a sign-in code
//   • their contact details never reach the Captains view
//   • a card payment taken at registration stays filed under the registration
//     and the team reads as owing its full fee
//
// This does the whole thing in one action: creates the team, mints the code,
// binds the coach's login, seeds the ledger, stamps assigned_team_id on the
// submission, and moves any pre-assignment payment onto the team.
//
// Admin-only. Idempotent: provisionTeamFromRegistration resolves the same
// registration to the same team, so a double-click cannot create two.

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";
import { provisionTeamFromRegistration } from "@/lib/provision-team";

export const runtime = "nodejs";

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

  let body: { leagueId?: unknown; submissionId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const leagueId = body.leagueId;
  const submissionId = body.submissionId;
  if (typeof leagueId !== "string" || !/^[a-z0-9_-]+$/.test(leagueId)) {
    return NextResponse.json({ error: "leagueId required" }, { status: 400 });
  }
  if (
    typeof submissionId !== "string" ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(submissionId)
  ) {
    return NextResponse.json({ error: "submissionId required" }, { status: 400 });
  }

  const leagues = decoded.leagues as Record<string, string> | undefined;
  if (leagues?.[leagueId] !== "admin") {
    return NextResponse.json(
      { error: `Not admin of league "${leagueId}"` },
      { status: 403 },
    );
  }

  const db = getAdminDb();
  const subRef = db.doc(
    `leagues/${leagueId}/form_submissions/team_registration/items/${submissionId}`,
  );
  const snap = await subRef.get();
  if (!snap.exists) {
    return NextResponse.json({ error: "Registration not found" }, { status: 404 });
  }
  const data = snap.data() ?? {};

  const result = await provisionTeamFromRegistration(
    leagueId,
    submissionId,
    data,
  );
  if (!result.teamId) {
    return NextResponse.json(
      {
        error:
          "This registration has no team name or age group, so a team cannot be created from it.",
      },
      { status: 400 },
    );
  }

  await subRef.set(
    {
      assigned_team_id: result.teamId,
      assigned_at: new Date().toISOString(),
      assigned_by_uid: decoded.uid,
    },
    { merge: true },
  );

  // Money taken before the team existed. /api/square-pay files that under the
  // registration; this is the moment it can move onto the team. Left behind,
  // the new team reads as owing its full fee and the reminder tool emails a
  // coach who has already paid.
  try {
    const legacyRef = db.doc(
      `leagues/${leagueId}/team_payments/reg-${submissionId}`,
    );
    const legacy = await legacyRef.get();
    if (legacy.exists) {
      await db
        .doc(`leagues/${leagueId}/team_payments/${result.teamId}`)
        .set({ ...legacy.data(), team_assigned: true }, { merge: true });
      await legacyRef.delete();
    }
  } catch (err) {
    console.error("[admin-provision-team] could not move the payment row", {
      leagueId,
      submissionId,
      teamId: result.teamId,
      err,
    });
  }

  await db.collection(`leagues/${leagueId}/audit`).add({
    kind: "team_provisioned_from_registration",
    by_uid: decoded.uid,
    by_role: "admin",
    changes: {
      submission_id: submissionId,
      team_id: result.teamId,
      created: result.created,
    },
    at: new Date().toISOString(),
  });

  return NextResponse.json({
    ok: true,
    teamId: result.teamId,
    created: result.created,
    // So the office can pass the coach their sign-in code straight away.
    teamCode: result.teamCode,
  });
}
