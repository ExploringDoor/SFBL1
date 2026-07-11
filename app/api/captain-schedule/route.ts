// POST /api/captain-schedule — captain edits / creates their team's game.
//
// Actions:
//   - (default, no action set) — edit an existing game. Allowed
//     mutations: date / time / field / status.
//   - action: "create" — captain schedules a new game. The captain's
//     team MUST be one of the two participants (home or away);
//     they can't create games between two other teams. Admin can
//     pass any pair of team ids.
//
// Server-side because /games is admin-write at the rules level. We
// allow either captain in the matchup to edit so weather reschedules
// can come from either side.
//
// Audit trail: every edit/create appends to /audit/{auto_id} with
// who-changed-what so commissioners can see schedule churn.

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";
import {
  fanoutPush,
  originFromRequest,
} from "@/lib/notifications/server-fanout";
import { isValidClockTime } from "@/lib/format-time";

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
    decoded = await getAdminAuth().verifyIdToken(idToken, true);
  } catch {
    return NextResponse.json(
      { error: "Invalid or expired token" },
      { status: 401 },
    );
  }

  let body: {
    leagueId?: unknown;
    action?: unknown;
    gameId?: unknown;
    date?: unknown;
    time?: unknown;
    field?: unknown;
    status?: unknown;
    // Create-action only — used when scheduling a new game.
    game?: unknown;
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
  if (typeof leagueId !== "string" || !leagueId) {
    return NextResponse.json(
      { error: "Body must include { leagueId }" },
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

  // ── action: "create" — captain (or admin) schedules a new game.
  if (body.action === "create") {
    const g = (body.game ?? {}) as Record<string, unknown>;
    const awayId = typeof g.away_team_id === "string" ? g.away_team_id : "";
    const homeId = typeof g.home_team_id === "string" ? g.home_team_id : "";
    if (!awayId || !homeId) {
      return NextResponse.json(
        { error: "Game needs away_team_id + home_team_id" },
        { status: 400 },
      );
    }
    if (awayId === homeId) {
      return NextResponse.json(
        { error: "Home and away can't be the same team" },
        { status: 400 },
      );
    }
    if (!isAdmin && captainTeamId !== awayId && captainTeamId !== homeId) {
      return NextResponse.json(
        {
          error:
            "Captains can only schedule games involving their own team",
        },
        { status: 403 },
      );
    }
    // Verify both teams actually exist in this league. Prevents typos
    // / API-poking from creating ghost-team entries.
    const [awayDoc, homeDoc] = await Promise.all([
      db.doc(`leagues/${leagueId}/teams/${awayId}`).get(),
      db.doc(`leagues/${leagueId}/teams/${homeId}`).get(),
    ]);
    if (!awayDoc.exists || !homeDoc.exists) {
      return NextResponse.json(
        { error: "One or both teams don't exist in this league" },
        { status: 400 },
      );
    }

    // Generate a fresh game id. Same `g-NNNN` pattern admin-schedule
    // uses so the data shape stays consistent across surfaces.
    const allGamesSnap = await db
      .collection(`leagues/${leagueId}/games`)
      .get();
    let maxNum = 0;
    for (const d of allGamesSnap.docs) {
      const m = d.id.match(/^g-(\d+)$/);
      if (m) {
        const n = parseInt(m[1]!, 10);
        if (n > maxNum) maxNum = n;
      }
    }
    const newId = `g-${String(maxNum + 1).padStart(4, "0")}`;

    const doc: Record<string, unknown> = {
      away_team_id: awayId,
      home_team_id: homeId,
      // Pull division from either team's doc if not supplied — the
      // schedule editor + standings need it. Captain UI will normally
      // pass the team's own division.
      division:
        typeof g.division === "string" && g.division
          ? g.division
          : String(awayDoc.data()?.division ?? homeDoc.data()?.division ?? ""),
      // Audit H10: store a clean "YYYY-MM-DD" or null — never "".
      // The update path already normalizes "" → null; the create
      // path was the inconsistent one. Empty/garbage dates stored as
      // "" render downstream as "Invalid Date" instead of "TBD", and
      // the old code stored an unvalidated 10-char slice of whatever
      // was posted.
      date: (() => {
        if (typeof g.date !== "string" || !g.date) return null;
        const d = g.date.slice(0, 10);
        return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
      })(),
      // Audit M3: validate hour 0-23 / minute 0-59, not just shape —
      // a bare regex stores garbage like "25:00".
      time:
        typeof g.time === "string" && isValidClockTime(g.time)
          ? g.time
          : null,
      field: typeof g.field === "string" ? g.field.trim() : "",
      status: "scheduled" as const,
      away_score: 0,
      home_score: 0,
      created_at: new Date().toISOString(),
      created_by_uid: decoded.uid,
      created_by_role: isAdmin ? "admin" : "captain",
    };
    await db.doc(`leagues/${leagueId}/games/${newId}`).set(doc);

    await db
      .collection(`leagues/${leagueId}/audit`)
      .add({
        kind: "schedule_create",
        game_id: newId,
        by_uid: decoded.uid,
        by_role: isAdmin ? "admin" : "captain",
        changes: doc,
        at: new Date().toISOString(),
      })
      .catch(() => {});

    return NextResponse.json({ ok: true, gameId: newId, game: doc });
  }

  // ── action: (default) — edit existing game ────────────────────
  const gameId = body.gameId;
  if (typeof gameId !== "string" || !gameId) {
    return NextResponse.json(
      { error: "Body must include { gameId }" },
      { status: 400 },
    );
  }

  // `db` already initialized above the action branch.
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
  // `time` is the new captain-side field — paired with `date` as
  // two plain strings (YYYY-MM-DD + HH:MM) rather than a combined
  // UTC ISO, which was the shape that created the "every game at
  // 8 PM" bug for EDT users.
  if (body.time !== undefined) {
    if (body.time === null || body.time === "") {
      update.time = null; // explicit "time TBD"
    } else if (typeof body.time === "string" && isValidClockTime(body.time)) {
      update.time = body.time;
    } else {
      // Audit M3: reject "25:00" / "9:75" / junk on edit instead of
      // silently storing it (the old path stored any truthy string).
      return NextResponse.json(
        { error: "time must be HH:MM (00:00–23:59) or empty" },
        { status: 400 },
      );
    }
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

  // Audit M17 (note, not a bug): the edit path stamps
  // updated_at/updated_by_uid but never created_by_uid — that field
  // is written only by the create flow above. "Who first created
  // this game" is therefore answerable only for games made via this
  // endpoint's create branch; pre-existing/imported games have no
  // creator. The dedicated /audit log entry below is the
  // authoritative per-mutation trail.
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
