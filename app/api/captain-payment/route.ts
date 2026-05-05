// POST /api/captain-payment — captain tracks fee collection for a
// player on their team.
//
// Fields the captain can patch:
//   - paid (bool)        — quick paid/unpaid flag (legacy)
//   - amount_paid (num)  — actual $ collected so far (supports partial)
//   - amount_due (num)   — what this player owes (defaults from league
//                          config; captain can override per-player for
//                          discounts, late fees, etc.)
//   - note (string)      — free text ("Venmo 4/12", "owes $50 cash")
//
// Stored at /leagues/{leagueId}/payments/{playerId}. The captain's
// claim only authorizes them for their own team, so we verify the
// target player belongs to that team before any write — the same
// pattern as /api/captain-roster.
//
// Status is derived (not stored): paid if amount_paid >= amount_due,
// partial if 0 < amount_paid < amount_due, else unpaid. We keep the
// legacy `paid` boolean for a clean migration off it.

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";

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
    decoded = await getAdminAuth().verifyIdToken(idToken);
  } catch {
    return NextResponse.json(
      { error: "Invalid or expired token" },
      { status: 401 },
    );
  }

  let body: {
    leagueId?: unknown;
    playerId?: unknown;
    paid?: unknown;
    note?: unknown;
    amount_paid?: unknown;
    amount_due?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const leagueId = body.leagueId;
  const playerId = body.playerId;
  if (typeof leagueId !== "string" || !leagueId) {
    return NextResponse.json(
      { error: "Body must include { leagueId }" },
      { status: 400 },
    );
  }
  if (typeof playerId !== "string" || !playerId) {
    return NextResponse.json(
      { error: "Body must include { playerId }" },
      { status: 400 },
    );
  }

  const leagues = decoded.leagues as Record<string, string> | undefined;
  const claim = leagues?.[leagueId];
  let captainTeamId: string | null = null;
  let isAdmin = false;
  if (claim === "admin") isAdmin = true;
  else if (typeof claim === "string" && claim.startsWith("captain:")) {
    captainTeamId = claim.slice("captain:".length);
  } else {
    return NextResponse.json(
      { error: `Not admin/captain of league "${leagueId}"` },
      { status: 403 },
    );
  }

  const db = getAdminDb();
  const playerSnap = await db
    .doc(`leagues/${leagueId}/players/${playerId}`)
    .get();
  if (!playerSnap.exists) {
    return NextResponse.json(
      { error: "Player not found" },
      { status: 404 },
    );
  }
  if (!isAdmin && playerSnap.data()?.team_id !== captainTeamId) {
    return NextResponse.json(
      { error: "Player isn't on your team" },
      { status: 403 },
    );
  }

  const update: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    updated_by_uid: decoded.uid,
  };
  if (typeof body.paid === "boolean") update.paid = body.paid;
  if (typeof body.note === "string") update.note = body.note;
  // Money fields: accept finite numbers ≥ 0; coerce numeric strings.
  // Reject NaN, Infinity, negatives.
  function parseMoney(raw: unknown): number | null | undefined {
    if (raw === undefined) return undefined;
    if (raw === null || raw === "") return null;
    const n = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(n) || n < 0) return undefined;
    // Round to whole cents to avoid float drift in stored values.
    return Math.round(n * 100) / 100;
  }
  const amountPaid = parseMoney(body.amount_paid);
  if (amountPaid !== undefined) update.amount_paid = amountPaid;
  const amountDue = parseMoney(body.amount_due);
  if (amountDue !== undefined) update.amount_due = amountDue;
  // Always set the team_id so the doc can be queried alongside the
  // player without an extra join.
  update.team_id = playerSnap.data()?.team_id ?? null;
  update.player_id = playerId;
  await db
    .doc(`leagues/${leagueId}/payments/${playerId}`)
    .set(update, { merge: true });
  return NextResponse.json({ ok: true });
}
