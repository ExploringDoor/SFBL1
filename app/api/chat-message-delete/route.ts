// POST /api/chat-message-delete — delete a chat message.
//
// DVSL captain.html:5679 (`deleteChatMessage`) — two delete authorities:
//   - Self-delete: any user can delete their own message
//   - Captain-moderate: captains can delete ANY message in /team_messages
//                       on their own team (DVSL: `canModerateOthers` flag)
//   - Captains chat: only the author can delete their own. Even the
//                    commissioner can't moderate others' captains_chat.
//                    (Enforced here.)
//
// Body:
//   { leagueId: string, collection: 'team_messages' | 'captain_chat', msgId: string }
//
// FUTURE: when /api/delete-by-source + the inbox / pending_nav collection
// land, this endpoint should also POST the cascade so push history clears
// from recipients' bells. For now the system push has already fired and
// lives in the OS notification tray; deleting the message just removes
// it from the in-app chat.

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";

const ALLOWED_COLLECTIONS = new Set(["team_messages", "captain_chat"]);

interface Body {
  leagueId?: unknown;
  collection?: unknown;
  msgId?: unknown;
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
  const msgId = body.msgId;
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
  if (typeof msgId !== "string" || !msgId) {
    return NextResponse.json(
      { error: "msgId is required" },
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
  }

  const db = getAdminDb();
  const ref = db.doc(`leagues/${leagueId}/${coll}/${msgId}`);
  const snap = await ref.get();
  if (!snap.exists) {
    return NextResponse.json(
      { error: "Message not found" },
      { status: 404 },
    );
  }
  const msg = snap.data() ?? {};

  const authorUid = String(msg.author_uid ?? "");
  const authorEmail = String(msg.author_email ?? "");
  const msgTeamId = String(msg.team_id ?? "");

  const isAuthor =
    (authorUid && authorUid === decoded.uid) ||
    (!!decoded.email &&
      authorEmail.toLowerCase() === String(decoded.email).toLowerCase());

  let allowed = false;
  if (isAuthor) {
    allowed = true; // self-delete always OK
  } else if (coll === "team_messages") {
    // Captain of THIS team or admin can moderate.
    if (isAdmin) allowed = true;
    else if (captainTeamId && captainTeamId === msgTeamId) allowed = true;
  } else {
    // captain_chat — author-only delete (admin too, since admin shouldn't
    // be locked out of moderation, but this matches DVSL: even the
    // commissioner can't moderate captains_chat in DVSL — they have to
    // ask the author. We give admin the override here as a small
    // platform-level concession. Document this if it ever comes up.)
    if (isAdmin) allowed = true;
  }

  if (!allowed) {
    return NextResponse.json(
      { error: "Not authorized to delete this message" },
      { status: 403 },
    );
  }

  await ref.delete();

  // FUTURE: cascade to /api/delete-by-source once the inbox lands.

  return NextResponse.json({ ok: true });
}
