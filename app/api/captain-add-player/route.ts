// POST /api/captain-add-player — captain adds a walk-on to their
// roster. Creates a `players/{auto_id}` doc on the captain's team
// with the supplied name + jersey number, returns the new player_id.
//
// Why this lives on the server:
//   /players/{playerId} is admin-write at the rules level
//   (firestore.rules:94). We don't want to widen those rules to
//   accept any captain-driven player creation, so an authenticated
//   endpoint mediates the write.
//
// Auth: bearer token. Caller must have either `admin` claim for the
// league or a `captain:<team_id>` claim — the new player is forced
// onto that team_id (a captain can never seed a player onto another
// team via this endpoint).

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";
import { cleanName } from "@/lib/text";

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
    decoded = await getAdminAuth().verifyIdToken(idToken, true);
  } catch {
    return NextResponse.json(
      { error: "Invalid or expired token" },
      { status: 401 },
    );
  }

  let body: {
    leagueId?: unknown;
    name?: unknown;
    jersey?: unknown;
    teamId?: unknown;
    position?: unknown;
    email?: unknown;
    phone?: unknown;
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
  // Normalize the input name immediately. cleanName collapses Unicode
  // separators (NBSP, narrow NBSP, etc.) so names pasted from Word or
  // PDF can't slug to a different player than what the captain types
  // later. Same protection as the provision script.
  const rawName =
    typeof body.name === "string" ? cleanName(body.name) : null;
  if (typeof leagueId !== "string" || !leagueId) {
    return NextResponse.json(
      { error: "Body must include { leagueId }" },
      { status: 400 },
    );
  }
  if (rawName == null || !rawName) {
    return NextResponse.json(
      { error: "Body must include { name }" },
      { status: 400 },
    );
  }

  const leagues = decoded.leagues as Record<string, string> | undefined;
  const claim = leagues?.[leagueId];
  let teamId: string;
  if (claim === "admin") {
    if (typeof body.teamId !== "string" || !body.teamId) {
      return NextResponse.json(
        { error: "Admin must include { teamId } in body" },
        { status: 400 },
      );
    }
    teamId = body.teamId;
  } else if (typeof claim === "string" && claim.startsWith("captain:")) {
    // Captains can ONLY add to their own team — ignore any teamId in
    // body and force their captain claim's team.
    teamId = claim.slice("captain:".length);
  } else {
    return NextResponse.json(
      { error: `Not admin/captain of league "${leagueId}"` },
      { status: 403 },
    );
  }

  const db = getAdminDb();

  // Build a stable player id from the name. If we collide with an
  // existing player on this team, append a numeric suffix.
  const slug = rawName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "walkon";
  let playerId = slug;
  for (let i = 1; i < 99; i++) {
    const exists = await db
      .doc(`leagues/${leagueId}/players/${playerId}`)
      .get();
    if (!exists.exists) break;
    playerId = `${slug}-${i + 1}`;
  }

  const jerseyNum =
    body.jersey === "" || body.jersey == null
      ? null
      : Number(body.jersey);

  // Optional contact metadata. Only admins typically have this on
  // hand at signup; captains can edit it later via the roster
  // editor. Stored as strings (we don't validate phone format —
  // commissioners enter what's on the registration sheet).
  const position =
    typeof body.position === "string" ? body.position.trim() : "";
  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const phone =
    typeof body.phone === "string" ? body.phone.trim() : "";

  // Public doc: name, jersey, position, team, walk_on flag — never
  // PII. email + phone go in /_private/contact below so they aren't
  // public-readable.
  await db.doc(`leagues/${leagueId}/players/${playerId}`).set({
    name: rawName,
    team_id: teamId,
    jersey: Number.isFinite(jerseyNum as number) ? jerseyNum : null,
    ...(position ? { position } : {}),
    walk_on: claim !== "admin", // captain-added marker for admin review
    created_by_uid: decoded.uid,
    created_at: new Date().toISOString(),
    active: true,
    // Defensive: every player created via the supported APIs gets
    // `status: "active"`. The shared captain/admin/public filters
    // skip docs whose status is something else (LBDC migration
    // creates `status: "unknown"` orphans). This guarantees a new
    // player can never accidentally inherit the orphan treatment.
    status: "active",
  });

  // Private contact subdoc — only readable by admin or the player
  // themselves once linked (firestore.rules:131).
  if (email || phone) {
    await db
      .doc(`leagues/${leagueId}/players/${playerId}/_private/contact`)
      .set(
        {
          ...(email ? { email } : {}),
          ...(phone ? { phone } : {}),
          updated_at: new Date().toISOString(),
        },
        { merge: true },
      );
  }

  return NextResponse.json({ ok: true, player_id: playerId });
}
