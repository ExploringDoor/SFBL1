// POST /api/availability-rsvp — set or clear a player's RSVP for a game.
//
// Verbatim port of DVSL captain.html `setAvail` / `setCaptainAvail` /
// `clearAvail` (lines 5346, 5511, 5555). DVSL writes directly via the
// client SDK because their security rules are open within the tenant;
// LE mediates via this endpoint so we can verify ownership server-side
// (captain may write for any player on their team; player may write
// only for their own linked player record).
//
// Request body:
//   {
//     leagueId: string,
//     gameId: string,
//     playerId: string,
//     status: 'yes' | 'maybe' | 'no' | 'clear'   // 'clear' deletes the doc
//   }
//
// Doc id convention (matches DVSL): `${team_id}_${game_id}_${player_id}`.
// Stored at `/leagues/{leagueId}/availability/{docId}` — the leagueId is
// in the path so we don't double it in the doc id.

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";

const ALLOWED_STATUSES = new Set(["yes", "maybe", "no", "clear"]);

interface Body {
  leagueId?: unknown;
  gameId?: unknown;
  playerId?: unknown;
  status?: unknown;
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
  const gameId = body.gameId;
  const playerId = body.playerId;
  const status = body.status;

  if (typeof leagueId !== "string" || !leagueId) {
    return NextResponse.json(
      { error: "Body must include { leagueId }" },
      { status: 400 },
    );
  }
  if (typeof gameId !== "string" || !gameId) {
    return NextResponse.json(
      { error: "Body must include { gameId }" },
      { status: 400 },
    );
  }
  if (typeof playerId !== "string" || !playerId) {
    return NextResponse.json(
      { error: "Body must include { playerId }" },
      { status: 400 },
    );
  }
  if (typeof status !== "string" || !ALLOWED_STATUSES.has(status)) {
    return NextResponse.json(
      { error: "status must be one of yes|maybe|no|clear" },
      { status: 400 },
    );
  }
  // Defensive — would break the doc-id path otherwise. Real player_ids
  // never contain these chars.
  if (/[\s/]/.test(gameId) || /[\s/]/.test(playerId)) {
    return NextResponse.json(
      { error: "Invalid id format" },
      { status: 400 },
    );
  }

  const leagues = decoded.leagues as Record<string, string> | undefined;
  const claim = leagues?.[leagueId];
  let captainTeamId: string | null = null;
  let isAdmin = false;
  if (claim === "admin") {
    isAdmin = true;
  } else if (typeof claim === "string" && claim.startsWith("captain:")) {
    captainTeamId = claim.slice("captain:".length);
  } else if (
    typeof claim === "string" &&
    claim.startsWith("player:")
  ) {
    // player claim — they can only RSVP for their own linked player.
    // Verified below against the player doc's auth_uid.
  } else {
    return NextResponse.json(
      { error: `No role in league "${leagueId}"` },
      { status: 403 },
    );
  }

  const db = getAdminDb();

  // Look up the target player to verify (a) they exist on this team, and
  // (b) the caller has authority to RSVP on their behalf.
  const playerSnap = await db
    .doc(`leagues/${leagueId}/players/${playerId}`)
    .get();
  if (!playerSnap.exists) {
    return NextResponse.json(
      { error: "Player not found" },
      { status: 404 },
    );
  }
  const player = playerSnap.data() ?? {};
  const teamId = String(player.team_id ?? "");
  if (!teamId) {
    return NextResponse.json(
      { error: "Player has no team_id" },
      { status: 400 },
    );
  }

  // Authority check.
  if (!isAdmin) {
    if (captainTeamId) {
      // Captain — must be the captain of the target player's team.
      if (captainTeamId !== teamId) {
        return NextResponse.json(
          { error: "Player isn't on your team" },
          { status: 403 },
        );
      }
    } else {
      // Player — must own this player record.
      const playerAuthUid = player.auth_uid;
      if (
        typeof playerAuthUid !== "string" ||
        playerAuthUid !== decoded.uid
      ) {
        return NextResponse.json(
          { error: "You can only RSVP for your own player record" },
          { status: 403 },
        );
      }
    }
  }

  // Verify the game exists and involves this team — prevents writes for
  // unrelated leagues' games sneaking in via crafted body.
  const gameSnap = await db
    .doc(`leagues/${leagueId}/games/${gameId}`)
    .get();
  if (!gameSnap.exists) {
    return NextResponse.json(
      { error: "Game not found" },
      { status: 404 },
    );
  }
  const game = gameSnap.data() ?? {};
  if (game.away_team_id !== teamId && game.home_team_id !== teamId) {
    return NextResponse.json(
      { error: "Game doesn't involve this team" },
      { status: 400 },
    );
  }

  const docId = `${teamId}_${gameId}_${playerId}`;
  const ref = db.doc(`leagues/${leagueId}/availability/${docId}`);

  if (status === "clear") {
    await ref.delete().catch(() => {
      /* idempotent — deleting a missing doc is a no-op */
    });
    return NextResponse.json({ ok: true, cleared: true, docId });
  }

  await ref.set(
    {
      game_id: gameId,
      player_id: playerId,
      player_name: String(player.name ?? ""),
      team_id: teamId,
      status,
      updated_at: new Date().toISOString(),
      updated_by_uid: decoded.uid,
    },
    { merge: true },
  );

  return NextResponse.json({ ok: true, docId, status });
}
