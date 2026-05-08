// POST /api/captain-roster — captain CRUD on their team's roster.
//
// Mirrors DVSL captain.html's renderRoster + saveNewPlayer / saveEditPlayer
// / removePlayer / captApproveJoinRequest / captRejectJoinRequest /
// captRevokeClaim (lines 2458–2682). Server-side because /players is
// admin-write only at the rules level (firestore.rules:94) — we don't
// want to widen those rules to accept any captain-driven write, so
// this endpoint mediates.
//
// Auth: bearer token. Caller must have `captain:<team_id>` claim for
// the league. Admin tokens are also accepted for cases where an admin
// is fixing a roster on a captain's behalf.
//
// Actions:
//   add     — create a new player on the captain's team
//   update  — edit an existing player's name/num/pos/email/phone
//   remove  — delete the player doc
//   approve — flip a self-registered player from pending to active
//   reject  — delete a self-registered pending request
//   revoke  — strip auth_uid + email from a player so they can re-claim
//
// All actions verify the target player belongs to the captain's team
// before any write — a captain of team_a can never touch team_b's
// roster, no matter what player_id they pass.

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";
import { cleanName } from "@/lib/text";

export const runtime = "nodejs";

type Action =
  | "add"
  | "update"
  | "remove"
  | "approve"
  | "reject"
  | "revoke";

export async function POST(req: Request) {
  // 1) Auth ────────────────────────────────────────────────────
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

  // 2) Parse body ──────────────────────────────────────────────
  let body: {
    leagueId?: unknown;
    action?: unknown;
    playerId?: unknown;
    name?: unknown;
    num?: unknown;
    pos?: unknown;
    email?: unknown;
    phone?: unknown;
    teamId?: unknown;
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
  const action = body.action as Action;
  if (typeof leagueId !== "string" || !leagueId) {
    return NextResponse.json(
      { error: "Body must include { leagueId }" },
      { status: 400 },
    );
  }
  if (
    !["add", "update", "remove", "approve", "reject", "revoke"].includes(
      action,
    )
  ) {
    return NextResponse.json(
      { error: `Unknown action: ${String(action)}` },
      { status: 400 },
    );
  }

  // 3) Claim → team scope ──────────────────────────────────────
  const leagues = decoded.leagues as Record<string, string> | undefined;
  const claim = leagues?.[leagueId];
  let captainTeamId: string;
  let isAdmin = false;
  if (claim === "admin") {
    isAdmin = true;
    if (typeof body.teamId !== "string" || !body.teamId) {
      return NextResponse.json(
        { error: "Admin must include { teamId } in body" },
        { status: 400 },
      );
    }
    captainTeamId = body.teamId;
  } else if (typeof claim === "string" && claim.startsWith("captain:")) {
    captainTeamId = claim.slice("captain:".length);
  } else {
    return NextResponse.json(
      { error: `Not admin/captain of league "${leagueId}"` },
      { status: 403 },
    );
  }

  const db = getAdminDb();

  // ── ADD ──────────────────────────────────────────────────────
  if (action === "add") {
    // cleanName normalizes Unicode separators (NBSP, narrow NBSP, etc.)
    // before BOTH the slug computation AND the persisted name, so a
    // captain pasting from Word or PDF can't seed a different doc id
    // than what they later type in clean.
    const rawName =
      typeof body.name === "string" ? cleanName(body.name) : "";
    if (!rawName) {
      return NextResponse.json(
        { error: "name required" },
        { status: 400 },
      );
    }
    // Generate a stable slug-id from the name; collision-suffix if
    // an existing player on the team has it.
    const slug = rawName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "player";
    let playerId = slug;
    for (let i = 1; i < 99; i++) {
      const ex = await db
        .doc(`leagues/${leagueId}/players/${playerId}`)
        .get();
      if (!ex.exists) break;
      playerId = `${slug}-${i + 1}`;
    }
    const jersey =
      body.num === "" || body.num == null
        ? null
        : Number(body.num);
    // Public doc: never PII. email/phone go to /_private/contact.
    await db.doc(`leagues/${leagueId}/players/${playerId}`).set({
      name: rawName,
      team_id: captainTeamId,
      jersey: Number.isFinite(jersey as number) ? jersey : null,
      position:
        typeof body.pos === "string" && body.pos.trim()
          ? body.pos.trim()
          : null,
      walk_on: !isAdmin, // captain-added → flagged for admin review
      created_by_uid: decoded.uid,
      created_at: new Date().toISOString(),
      active: true,
    });
    const email =
      typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const phone =
      typeof body.phone === "string" ? body.phone.trim() : "";
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

  // For all other actions we need the player to already exist AND
  // belong to the caller's team scope.
  const playerId = body.playerId;
  if (typeof playerId !== "string" || !playerId) {
    return NextResponse.json(
      { error: "Body must include { playerId } for this action" },
      { status: 400 },
    );
  }
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
  if (!isAdmin && player.team_id !== captainTeamId) {
    return NextResponse.json(
      { error: "Player isn't on your team" },
      { status: 403 },
    );
  }

  // ── UPDATE ───────────────────────────────────────────────────
  if (action === "update") {
    // Split fields: public-doc updates vs PII updates (which go to
    // the /_private/contact subdoc). Public-readable doc never gets
    // email or phone.
    const publicUpdate: Record<string, unknown> = {};
    if (typeof body.name === "string") publicUpdate.name = cleanName(body.name);
    if (body.num !== undefined) {
      const n = Number(body.num);
      publicUpdate.jersey = Number.isFinite(n) ? n : null;
    }
    if (typeof body.pos === "string") {
      publicUpdate.position = body.pos.trim() || null;
    }
    publicUpdate.updated_at = new Date().toISOString();
    publicUpdate.updated_by_uid = decoded.uid;
    await db
      .doc(`leagues/${leagueId}/players/${playerId}`)
      .set(publicUpdate, { merge: true });

    const contactUpdate: Record<string, unknown> = {};
    if (typeof body.email === "string") {
      contactUpdate.email = body.email.trim().toLowerCase();
    }
    if (typeof body.phone === "string") {
      contactUpdate.phone = body.phone.trim();
    }
    if (Object.keys(contactUpdate).length > 0) {
      contactUpdate.updated_at = new Date().toISOString();
      await db
        .doc(`leagues/${leagueId}/players/${playerId}/_private/contact`)
        .set(contactUpdate, { merge: true });
    }
    return NextResponse.json({ ok: true });
  }

  // ── REMOVE ───────────────────────────────────────────────────
  if (action === "remove") {
    // Firestore subcollections aren't auto-deleted with their parent.
    // Clean up the /_private/contact doc explicitly so we don't leave
    // an orphaned PII record behind. Best-effort: if the subdoc
    // lookup fails (or there's nothing there), still proceed with
    // the parent delete.
    try {
      await db
        .doc(`leagues/${leagueId}/players/${playerId}/_private/contact`)
        .delete();
    } catch (e) {
      console.warn("[captain-roster] _private/contact cleanup failed:", e);
    }
    await db.doc(`leagues/${leagueId}/players/${playerId}`).delete();
    return NextResponse.json({ ok: true });
  }

  // ── APPROVE ──────────────────────────────────────────────────
  if (action === "approve") {
    await db.doc(`leagues/${leagueId}/players/${playerId}`).set(
      {
        pending_approval: false,
        approved_at: new Date().toISOString(),
        approved_by_uid: decoded.uid,
      },
      { merge: true },
    );
    return NextResponse.json({ ok: true });
  }

  // ── REJECT (delete pending request) ──────────────────────────
  if (action === "reject") {
    if (!player.pending_approval) {
      return NextResponse.json(
        { error: "Player isn't pending approval" },
        { status: 400 },
      );
    }
    await db.doc(`leagues/${leagueId}/players/${playerId}`).delete();
    return NextResponse.json({ ok: true });
  }

  // ── REVOKE auth claim ────────────────────────────────────────
  if (action === "revoke") {
    await db.doc(`leagues/${leagueId}/players/${playerId}`).set(
      {
        auth_uid: null,
        revoked_at: new Date().toISOString(),
        revoked_by_uid: decoded.uid,
      },
      { merge: true },
    );
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json(
    { error: "Unhandled action" },
    { status: 400 },
  );
}
