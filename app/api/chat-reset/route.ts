// POST /api/chat-reset — captain-only nuke of an entire team chat
// (or admin nuke of any). Verbatim port of DVSL captain.html
// `resetTeamChat` (lines 5701-5722).
//
// Batches deletes at 400 docs to stay under Firestore's 500-op
// writeBatch limit (DVSL pattern; spec verification line 1306).
//
// Body:
//   {
//     leagueId: string,
//     collection: 'team_messages' | 'captain_chat',
//     teamId?: string,    // required for team_messages
//   }
//
// Authority:
//   - team_messages: captain of teamId (their own team) or admin
//   - captain_chat:  admin only (DVSL pattern — captains_chat is shared,
//                    no single captain owns it)

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";

const ALLOWED_COLLECTIONS = new Set(["team_messages", "captain_chat"]);
const MAX_BATCH = 400;

interface Body {
  leagueId?: unknown;
  collection?: unknown;
  teamId?: unknown;
}

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

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const leagueId = body.leagueId;
  const coll = body.collection;
  if (typeof leagueId !== "string" || !leagueId) {
    return NextResponse.json(
      { error: "leagueId is required" },
      { status: 400 },
    );
  }
  if (typeof coll !== "string" || !ALLOWED_COLLECTIONS.has(coll)) {
    return NextResponse.json(
      { error: "Invalid collection" },
      { status: 400 },
    );
  }

  const leagues = decoded.leagues as Record<string, string> | undefined;
  const claim = leagues?.[leagueId];
  const isAdmin = claim === "admin";
  const captainTeamId =
    typeof claim === "string" && claim.startsWith("captain:")
      ? claim.slice("captain:".length)
      : null;

  const db = getAdminDb();

  let q;
  if (coll === "team_messages") {
    if (typeof body.teamId !== "string" || !body.teamId) {
      return NextResponse.json(
        { error: "teamId is required for team_messages" },
        { status: 400 },
      );
    }
    const teamId = body.teamId;
    if (!isAdmin && captainTeamId !== teamId) {
      return NextResponse.json(
        { error: "You aren't captain of this team" },
        { status: 403 },
      );
    }
    q = db
      .collection(`leagues/${leagueId}/team_messages`)
      .where("team_id", "==", teamId);
  } else {
    if (!isAdmin) {
      return NextResponse.json(
        { error: "Only admins can reset captains chat" },
        { status: 403 },
      );
    }
    q = db.collection(`leagues/${leagueId}/captain_chat`);
  }

  const snap = await q.get();
  if (snap.empty) {
    return NextResponse.json({ ok: true, deleted: 0 });
  }

  // Batch in chunks of 400 (Firestore writeBatch is capped at 500;
  // staying under 500 leaves headroom for any trigger writes that
  // could be added later). Match DVSL's exact chunking.
  let remaining = snap.docs.slice();
  let deleted = 0;
  while (remaining.length) {
    const chunk = remaining.splice(0, MAX_BATCH);
    const batch = db.batch();
    chunk.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    deleted += chunk.length;
  }

  return NextResponse.json({ ok: true, deleted });
}
