// /api/admin-walkon-review — admin approves or rejects a captain-
// added walk-on player.
//
// Background: when a captain adds a player via /api/captain-add-player,
// the new doc gets `walk_on: true`. That flag flips a flag in the
// admin's signups-review queue so the commissioner can verify the
// addition (matching name spelling, jersey number, etc.) before the
// player counts toward roster eligibility / appears in tickers.
//
// Body shape:
//   { leagueId, playerId, action: "approve" | "reject" }
//
// Approve → sets walk_on=false, walk_on_approved_at, walk_on_approved_by_uid.
// Reject  → sets active=false (soft-delete) and walk_on_rejected_at.
//
// Auth: caller must be admin of leagueId.

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";

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
    decoded = await getAdminAuth().verifyIdToken(idToken, true);
  } catch {
    return NextResponse.json(
      { error: "Invalid or expired token" },
      { status: 401 },
    );
  }

  let body: {
    leagueId?: unknown;
    playerId?: unknown;
    action?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const leagueId = body.leagueId;
  const playerId = body.playerId;
  const action = body.action;
  if (typeof leagueId !== "string" || !leagueId) {
    return NextResponse.json(
      { error: "leagueId is required" },
      { status: 400 },
    );
  }
  if (typeof playerId !== "string" || !playerId) {
    return NextResponse.json(
      { error: "playerId is required" },
      { status: 400 },
    );
  }
  if (action !== "approve" && action !== "reject") {
    return NextResponse.json(
      { error: 'action must be "approve" or "reject"' },
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
  const ref = db.doc(`leagues/${leagueId}/players/${playerId}`);
  const before = await ref.get();
  if (!before.exists) {
    return NextResponse.json({ error: "Player not found" }, { status: 404 });
  }
  const data = before.data() ?? {};
  if (data.walk_on !== true) {
    return NextResponse.json(
      { error: "Player isn't a walk-on (already approved or never flagged)" },
      { status: 409 },
    );
  }

  const now = new Date().toISOString();
  if (action === "approve") {
    await ref.set(
      {
        walk_on: false,
        walk_on_approved_at: now,
        walk_on_approved_by_uid: decoded.uid,
      },
      { merge: true },
    );
  } else {
    await ref.set(
      {
        active: false,
        walk_on_rejected_at: now,
        walk_on_rejected_by_uid: decoded.uid,
      },
      { merge: true },
    );
  }

  await db.collection(`leagues/${leagueId}/audit`).add({
    kind: action === "approve" ? "walkon_approve" : "walkon_reject",
    by_uid: decoded.uid,
    by_role: "admin",
    changes: { player_id: playerId, name: data.name ?? null },
    at: now,
  });

  return NextResponse.json({ ok: true, action, playerId });
}
