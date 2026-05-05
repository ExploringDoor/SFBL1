// POST /api/chat-message — send a message to team chat (or, in Phase C,
// captains chat). Verbatim port of DVSL captain.html `sendTeamMsg`
// (lines 5778-5836) with multi-tenant scoping.
//
// Body shape:
//   {
//     leagueId: string,
//     collection: 'team_messages' | 'captain_chat',
//     teamId?: string,         // required for team_messages
//     text: string,
//   }
//
// On success: writes to /leagues/{leagueId}/{collection}/{auto_id} with
// the canonical doc shape (DVSL captain.html:5795), then fires a push
// via /api/send-notification with the matching category. The push is
// fire-and-forget; chat write success is what matters.
//
// Authority:
//   - team_messages: caller must be captain of teamId OR player on teamId
//   - captain_chat:  caller must be captain (any team) in this league
//   - admin: can send to either, on any team's behalf (rare; mostly for
//            moderation/announcements that benefit from chat-bubble rendering)

import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";

const ALLOWED_COLLECTIONS = new Set(["team_messages", "captain_chat"]);

interface Body {
  leagueId?: unknown;
  collection?: unknown;
  teamId?: unknown;
  text?: unknown;
  // Sender's FCM token (cached in localStorage on the device that sent
  // the message). Forwarded to /api/send-notification as `excludeToken`
  // so the sender's own device doesn't get pinged. Mirrors DVSL pattern
  // where `localStorage.getItem('dvsl-notif-token')` is passed in the
  // chat send body — DVSL-style except DVSL fires the push from the
  // client; we mediate via this endpoint, so the client has to thread
  // its token through. Optional — if missing, no self-suppress (matches
  // pre-fix behavior).
  senderToken?: unknown;
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

  if (typeof body.leagueId !== "string" || !body.leagueId) {
    return NextResponse.json(
      { error: "Body must include { leagueId }" },
      { status: 400 },
    );
  }
  if (
    typeof body.collection !== "string" ||
    !ALLOWED_COLLECTIONS.has(body.collection)
  ) {
    return NextResponse.json(
      { error: "collection must be 'team_messages' or 'captain_chat'" },
      { status: 400 },
    );
  }
  if (typeof body.text !== "string" || !body.text.trim()) {
    return NextResponse.json(
      { error: "text is required" },
      { status: 400 },
    );
  }

  const leagueId = body.leagueId;
  const coll = body.collection;
  const text = body.text.trim();

  if (text.length > 2000) {
    return NextResponse.json(
      { error: "Message too long (2000 char max)" },
      { status: 400 },
    );
  }

  const leagues = decoded.leagues as Record<string, string> | undefined;
  const claim = leagues?.[leagueId];
  let captainTeamId: string | null = null;
  let isAdmin = false;
  let playerTeamIds: string[] = [];
  if (claim === "admin") {
    isAdmin = true;
  } else if (typeof claim === "string" && claim.startsWith("captain:")) {
    captainTeamId = claim.slice("captain:".length);
  }
  // (player: claim is checked below by player-doc lookup; the claim string
  // alone doesn't carry team_id.)

  const db = getAdminDb();

  // Determine teamId for the target collection.
  let teamId: string | null = null;
  if (coll === "team_messages") {
    if (typeof body.teamId !== "string" || !body.teamId) {
      return NextResponse.json(
        { error: "teamId is required for team_messages" },
        { status: 400 },
      );
    }
    teamId = body.teamId;

    // Authority: admin OK; captain must own this team; player must be
    // rostered on this team.
    if (!isAdmin) {
      if (captainTeamId) {
        if (captainTeamId !== teamId) {
          return NextResponse.json(
            { error: "You aren't captain of this team" },
            { status: 403 },
          );
        }
      } else {
        // Look up the player record(s) linked to this auth uid in this
        // league. They must include a row with team_id === teamId.
        const playerSnap = await db
          .collection(`leagues/${leagueId}/players`)
          .where("auth_uid", "==", decoded.uid)
          .get();
        playerTeamIds = playerSnap.docs
          .map((d) => String(d.data().team_id ?? ""))
          .filter(Boolean);
        if (!playerTeamIds.includes(teamId)) {
          return NextResponse.json(
            { error: "You're not on this team" },
            { status: 403 },
          );
        }
      }
    }
  } else {
    // captain_chat — must be captain or admin in this league.
    if (!isAdmin && !captainTeamId) {
      return NextResponse.json(
        { error: "Only captains can post in captains chat" },
        { status: 403 },
      );
    }
    teamId = captainTeamId; // used for sender label
  }

  // ── Resolve author display name + team metadata ───────────────────
  // Prefer (in order): player.name with matching auth_uid → user displayName
  // → email local-part → "Captain". Mirrors DVSL captain.html:5781-5803.
  let authorName = "";
  let teamName = "";
  let teamColor = "";
  let teamShort = "";

  if (teamId) {
    const teamDoc = await db.doc(`leagues/${leagueId}/teams/${teamId}`).get();
    if (teamDoc.exists) {
      const t = teamDoc.data() ?? {};
      teamName = String(t.name ?? "");
      teamColor = String(t.color ?? "#0a0e1c");
      teamShort = String(t.abbrev ?? t.short ?? "");
    }
  }

  // Try to find the linked player on the message's team specifically —
  // gives us the captain's real first+last name for the bubble header.
  if (teamId) {
    const linkedPlayerSnap = await db
      .collection(`leagues/${leagueId}/players`)
      .where("auth_uid", "==", decoded.uid)
      .where("team_id", "==", teamId)
      .limit(1)
      .get();
    if (!linkedPlayerSnap.empty) {
      authorName = String(linkedPlayerSnap.docs[0]!.data().name ?? "");
    }
  }
  if (!authorName) {
    authorName =
      decoded.name ??
      (decoded.email ? String(decoded.email).split("@")[0]! : "") ??
      "Captain";
  }

  const authorEmail = String(decoded.email ?? "");
  const isCaptain = isAdmin || !!captainTeamId;

  // ── Write the message doc ─────────────────────────────────────────
  const docRef = db.collection(`leagues/${leagueId}/${coll}`).doc();
  const now = Timestamp.now();
  const docData: Record<string, unknown> = {
    text,
    author_email: authorEmail,
    author_name: authorName,
    author_uid: decoded.uid,
    is_captain: isCaptain,
    team_id: teamId,
    team_name: teamName,
    team_color: teamColor,
    team_short: teamShort,
    leagueId, // multi-tenant scope (also encoded in path; redundant but cheap)
    timestamp: now,
  };
  await docRef.set(docData);

  // ── Fire push (fire-and-forget; chat write is the success path) ───
  // Push title + body match DVSL captain.html:5800-5829 templates.
  const pushTitle =
    coll === "team_messages"
      ? authorName || `${teamShort || teamId || "Team"} — Captain`
      : `${teamShort || teamId || "Captains"} — ${authorName || "Captain"}`;
  const pushBody = text.length > 120 ? text.slice(0, 120) + "…" : text;
  // Push deep-link target. team_chat goes to /profile#teamchat
  // because both captains AND players need to land somewhere they
  // can read. /profile is universal — captain or player, anyone
  // signed in lands on the same chat thread (server-side auth check
  // gates write access; read works for anyone authed).
  // captains_chat stays /captain#captchat — only captains can be
  // there, /profile#captchat doesn't exist.
  const pushUrl =
    coll === "team_messages"
      ? `/profile#teamchat`
      : `/captain#captchat`;

  try {
    // Construct an absolute origin so the route can call its sibling
    // endpoint regardless of which host invoked us. Vercel sets
    // VERCEL_URL; locally we use the request's own origin.
    const origin =
      process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : new URL(req.url).origin;
    await fetch(`${origin}/api/send-notification`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        leagueId,
        title: pushTitle,
        body: pushBody,
        category: coll === "team_messages" ? "team_chat" : "captains_chat",
        ...(coll === "team_messages" && teamId ? { team: teamId } : {}),
        url: pushUrl,
        sourceId: docRef.id,
        // Suppress sender's own device — DVSL captain.html:5800 pattern.
        // Client passes this from its localStorage'd FCM token.
        ...(typeof body.senderToken === "string" && body.senderToken
          ? { excludeToken: body.senderToken }
          : {}),
      }),
    });
  } catch (e) {
    // Push failure is non-fatal — the in-app message is already saved.
    console.warn("[chat-message] push fan-out failed:", e);
  }

  return NextResponse.json({
    ok: true,
    msgId: docRef.id,
    author_name: authorName,
  });
}
