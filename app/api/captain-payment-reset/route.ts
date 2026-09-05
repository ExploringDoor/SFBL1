// POST /api/captain-payment-reset — clear a team's payment tracking for
// a fresh season. Zeroes what's been collected and wipes last season's
// notes for EVERY player on the captain's team, in one batched write.
//
// Deliberately KEEPS each player's `amount_due` ("Owes"). SFBL's league
// default fee is $0, so managers enter the per-player fee by hand — a
// reset that cleared `amount_due` would erase all of that. Next season
// you want everyone still owing their fee, just back to $0 collected.
//
//   amount_paid → 0
//   paid        → false   (legacy flag kept in sync)
//   note        → ""
//   amount_due  → unchanged
//
// Auth mirrors /api/captain-payment: a captain is scoped to their own
// team by their claim; an admin must pass { teamId } as a fat-finger
// guard. Only existing payment docs for the team are touched — a player
// who never had one already reads as $0/unpaid.

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
    decoded = await getAdminAuth().verifyIdToken(idToken, true);
  } catch {
    return NextResponse.json(
      { error: "Invalid or expired token" },
      { status: 401 },
    );
  }

  let body: { leagueId?: unknown; teamId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const leagueId = body.leagueId;
  if (typeof leagueId !== "string" || !leagueId) {
    return NextResponse.json(
      { error: "Body must include { leagueId }" },
      { status: 400 },
    );
  }

  const leagues = decoded.leagues as Record<string, string> | undefined;
  const claim = leagues?.[leagueId];
  let teamId: string;
  if (claim === "admin") {
    // Admins act on any team but must name it explicitly (same guard as
    // the sibling captain-* endpoints).
    if (typeof body.teamId !== "string" || !body.teamId) {
      return NextResponse.json(
        { error: "Admin must include { teamId } in body" },
        { status: 400 },
      );
    }
    teamId = body.teamId;
  } else if (typeof claim === "string" && claim.startsWith("captain:")) {
    // Captains are locked to their own team — body.teamId is ignored.
    teamId = claim.slice("captain:".length);
  } else {
    return NextResponse.json(
      { error: `Not admin/captain of league "${leagueId}"` },
      { status: 403 },
    );
  }

  const db = getAdminDb();
  // Every payment doc carries team_id (stamped by /api/captain-payment),
  // so this filter is exact and can't reach another team's rows.
  const snap = await db
    .collection(`leagues/${leagueId}/payments`)
    .where("team_id", "==", teamId)
    .get();

  if (snap.empty) {
    return NextResponse.json({ ok: true, reset: 0 });
  }

  const now = new Date().toISOString();
  const batch = db.batch();
  for (const doc of snap.docs) {
    batch.set(
      doc.ref,
      {
        amount_paid: 0,
        paid: false,
        note: "",
        updated_at: now,
        updated_by_uid: decoded.uid,
      },
      { merge: true },
    );
  }
  await batch.commit();

  return NextResponse.json({ ok: true, reset: snap.size });
}
