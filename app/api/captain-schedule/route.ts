// POST /api/captain-schedule — captain edits their team's game.
// Allowed mutations:
//   - date / time (one ISO datetime string)
//   - field (text)
//   - status: scheduled | postponed | cancelled
//
// Server-side because /games is admin-write at the rules level. We
// allow either captain in the matchup to edit the game so weather
// reschedules can come from either side. Admin can edit any game.
//
// Audit trail: every edit appends to /audit/{auto_id} with who-changed-what
// so commissioners can see schedule churn.

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";
import {
  fanoutPush,
  originFromRequest,
} from "@/lib/notifications/server-fanout";

export const runtime = "nodejs";

const ALLOWED_STATUS = new Set([
  "scheduled",
  "postponed",
  "cancelled",
  "final",
  "approved",
]);

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
    gameId?: unknown;
    date?: unknown;
    field?: unknown;
    status?: unknown;
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
  const gameId = body.gameId;
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
  const gameRef = db.doc(`leagues/${leagueId}/games/${gameId}`);
  const gameSnap = await gameRef.get();
  if (!gameSnap.exists) {
    return NextResponse.json(
      { error: "Game not found" },
      { status: 404 },
    );
  }
  const game = gameSnap.data() ?? {};
  if (
    !isAdmin &&
    captainTeamId !== game.away_team_id &&
    captainTeamId !== game.home_team_id
  ) {
    return NextResponse.json(
      { error: "You aren't a captain in this game" },
      { status: 403 },
    );
  }

  const update: Record<string, unknown> = {};
  if (body.date !== undefined) {
    if (typeof body.date === "string" && body.date) update.date = body.date;
    else if (body.date === null || body.date === "") update.date = null;
  }
  if (body.field !== undefined) {
    update.field =
      typeof body.field === "string" ? body.field.trim() : null;
  }
  if (body.status !== undefined) {
    if (
      typeof body.status === "string" &&
      ALLOWED_STATUS.has(body.status)
    ) {
      update.status = body.status;
    }
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json(
      { error: "No fields to update" },
      { status: 400 },
    );
  }

  update.updated_at = new Date().toISOString();
  update.updated_by_uid = decoded.uid;
  await gameRef.set(update, { merge: true });

  // Audit trail.
  await db
    .collection(`leagues/${leagueId}/audit`)
    .add({
      kind: "schedule_edit",
      game_id: gameId,
      by_uid: decoded.uid,
      by_role: isAdmin ? "admin" : "captain",
      changes: update,
      at: new Date().toISOString(),
    })
    .catch(() => {});

  // ── Push triggers ─────────────────────────────────────────────────
  // §5.4 (rainouts) — fires when status flips to postponed or
  // cancelled. Body wording matches DVSL captain.html:2782.
  // §5.5 (schedule) — fires when date or field actually changed
  // (not just status, not internal-only fields). Matches DVSL
  // captain.html:3068's `summary !== 'no visible field changes'`
  // guard, but simpler: explicit field comparison.
  const before = game; // captured pre-update (line 100)
  const after = { ...before, ...update };
  const teamsArr = [
    String(before.away_team_id ?? ""),
    String(before.home_team_id ?? ""),
  ].filter(Boolean);

  const statusChanged =
    update.status !== undefined && before.status !== update.status;
  const wentPostponed =
    statusChanged &&
    (update.status === "postponed" || update.status === "cancelled");
  const dateChanged =
    update.date !== undefined && before.date !== update.date;
  const fieldChanged =
    update.field !== undefined && before.field !== update.field;

  if (wentPostponed || dateChanged || fieldChanged) {
    const teamsSnap = await db
      .collection(`leagues/${leagueId}/teams`)
      .get();
    const teamNames: Record<string, string> = {};
    for (const d of teamsSnap.docs) {
      teamNames[d.id] = String(d.data().name ?? d.id);
    }
    const awayName =
      teamNames[String(before.away_team_id ?? "")] ?? "Away";
    const homeName =
      teamNames[String(before.home_team_id ?? "")] ?? "Home";
    const teamsLabel = `${awayName} @ ${homeName}`;
    const origin = originFromRequest(req);

    if (wentPostponed) {
      // §5.4 rainouts. Title format from DVSL captain.html:2782.
      const verb = update.status === "cancelled" ? "Cancelled" : "PPD";
      const dateLabel = after.date ? String(after.date) : "";
      const fieldLabel = after.field ? String(after.field) : "";
      await fanoutPush({
        origin,
        bearerToken: idToken,
        leagueId,
        category: "rainouts",
        title: `🌧 ${verb}: ${teamsLabel}`,
        body:
          `${[dateLabel, fieldLabel].filter(Boolean).join(" @ ") || "Game"} is ${verb === "Cancelled" ? "cancelled" : "postponed"}.` +
          " Reschedule TBD.",
        teams: teamsArr,
        url: "/schedule",
      });
    } else if (dateChanged || fieldChanged) {
      // §5.5 schedule change.
      const summary = [
        dateChanged ? `date → ${String(after.date ?? "TBD")}` : null,
        fieldChanged ? `field → ${String(after.field ?? "TBD")}` : null,
      ]
        .filter(Boolean)
        .join(", ");
      await fanoutPush({
        origin,
        bearerToken: idToken,
        leagueId,
        category: "schedule",
        title: `Schedule update: ${teamsLabel}`,
        body: summary || "Game schedule updated.",
        teams: teamsArr,
        url: "/schedule",
      });
    }
  }

  return NextResponse.json({ ok: true });
}
