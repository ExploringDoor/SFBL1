// /api/player-avatar — upload (or remove) a profile photo for a
// player record. Players upload their own; admins can upload any.
// Captains can upload for any player on their own team (handy when
// a player asks them to set it up).
//
// Storage: data URL on /leagues/{id}/players/{id}.photo_url. Public-
// readable since profile photos are intentionally visible. Player
// docs are public-read at the rules layer.
//
// Body shapes:
//   { leagueId, playerId, imageDataUrl }   — upload
//   { leagueId, playerId, action: "remove" } — clear

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";

// Cap the data URL string at ~1 MB encoded (≈750 KB pre-base64).
// Profile pics shouldn't be huge — the avatar circle is at most 120px.
// We do not down-sample server-side; client crops + resizes before
// upload (avoids paying the bandwidth cost of a 5 MB iPhone shot).
const MAX_DATA_URL = 1_500_000;

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
    imageDataUrl?: unknown;
    action?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const leagueId = body.leagueId;
  const playerId = body.playerId;
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

  // Authority: admin / self-player / captain-of-this-player's-team.
  const claim = (decoded.leagues as Record<string, string> | undefined)?.[
    leagueId
  ];
  const isAdmin = claim === "admin";
  const isSelf = claim === `player:${playerId}`;
  const captainTeam =
    typeof claim === "string" && claim.startsWith("captain:")
      ? claim.slice("captain:".length)
      : null;

  const db = getAdminDb();
  const ref = db.doc(`leagues/${leagueId}/players/${playerId}`);
  const snap = await ref.get();
  if (!snap.exists) {
    return NextResponse.json({ error: "Player not found" }, { status: 404 });
  }
  const player = snap.data() ?? {};

  const isCaptainOfTeam =
    !!captainTeam && captainTeam === String(player.team_id ?? "");

  if (!isAdmin && !isSelf && !isCaptainOfTeam) {
    return NextResponse.json(
      {
        error:
          "Need admin, captain-of-team, or self-player to update this profile photo",
      },
      { status: 403 },
    );
  }

  if (body.action === "remove") {
    await ref.set({ photo_url: null }, { merge: true });
    return NextResponse.json({ ok: true, photo_url: null });
  }

  if (
    typeof body.imageDataUrl !== "string" ||
    !body.imageDataUrl.startsWith("data:image/")
  ) {
    return NextResponse.json(
      { error: "imageDataUrl must be a data:image/* URL" },
      { status: 400 },
    );
  }
  if (body.imageDataUrl.length > MAX_DATA_URL) {
    return NextResponse.json(
      {
        error: `Photo is ${Math.round(body.imageDataUrl.length / 1024)} KB after encoding — keep originals under 750 KB. Crop tightly to your face for the cleanest avatar.`,
      },
      { status: 413 },
    );
  }

  await ref.set({ photo_url: body.imageDataUrl }, { merge: true });
  return NextResponse.json({ ok: true, photo_url: body.imageDataUrl });
}
