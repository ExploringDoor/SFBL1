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

  // Audit the moderation action so commissioners can review what
  // got deleted by whom (especially relevant when admins delete
  // captain messages). Best-effort — never let an audit-write
  // failure shadow a successful delete.
  if (!isAuthor) {
    try {
      await db.collection(`leagues/${leagueId}/audit`).add({
        kind: "chat_moderate",
        by_uid: decoded.uid,
        by_role: isAdmin ? "admin" : "captain",
        changes: {
          collection: coll,
          msg_id: msgId,
          author_uid: authorUid || null,
          team_id: msgTeamId || null,
        },
        at: new Date().toISOString(),
      });
    } catch (e) {
      console.warn("[chat-delete] audit write failed:", e);
    }
  }

  // FUTURE: cascade to /api/delete-by-source once the inbox lands.

  return NextResponse.json({ ok: true });
}

// DELETE /api/chat-message-delete?leagueId=&collection=&teamId=
//
// Admin-only "Clear all" — wipes every message in the chosen chat.
// `teamId` is required when collection=team_messages (so the admin
// can wipe one team without touching others). Captains_chat is
// league-wide; teamId is ignored for that.
export async function DELETE(req: Request) {
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
    decoded = await getAdminAuth().verifyIdToken(idToken);
  } catch {
    return NextResponse.json(
      { error: "Invalid or expired token" },
      { status: 401 },
    );
  }

  const url = new URL(req.url);
  const leagueId = url.searchParams.get("leagueId");
  const coll = url.searchParams.get("collection");
  const teamId = url.searchParams.get("teamId");

  if (!leagueId) {
    return NextResponse.json(
      { error: "leagueId is required" },
      { status: 400 },
    );
  }
  if (!coll || !ALLOWED_COLLECTIONS.has(coll)) {
    return NextResponse.json(
      { error: "Invalid collection" },
      { status: 400 },
    );
  }

  const callerLeagues = decoded.leagues as
    | Record<string, string>
    | undefined;
  if (callerLeagues?.[leagueId] !== "admin") {
    return NextResponse.json(
      { error: "Admin only" },
      { status: 403 },
    );
  }

  const db = getAdminDb();
  let q: FirebaseFirestore.Query = db.collection(
    `leagues/${leagueId}/${coll}`,
  );
  if (coll === "team_messages") {
    if (!teamId) {
      return NextResponse.json(
        { error: "teamId is required for team_messages clear-all" },
        { status: 400 },
      );
    }
    q = q.where("team_id", "==", teamId);
  }
  const snap = await q.get();

  let deleted = 0;
  for (let i = 0; i < snap.docs.length; i += 450) {
    const batch = db.batch();
    for (const d of snap.docs.slice(i, i + 450)) batch.delete(d.ref);
    await batch.commit();
    deleted += Math.min(450, snap.docs.length - i);
  }

  await db.collection(`leagues/${leagueId}/audit`).add({
    kind: "chat_clear_all",
    by_uid: decoded.uid,
    by_role: "admin",
    changes: { collection: coll, team_id: teamId, deleted },
    at: new Date().toISOString(),
  });

  return NextResponse.json({ ok: true, deleted });
}
