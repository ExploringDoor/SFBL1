// /api/admin-score-quick — admin batch score entry / conflict resolution.
//
// One endpoint, two flows:
//
// (A) Batch quick-score entry:
//   { leagueId, updates: [
//       { gameId, away_score, home_score, status?: 'final' | 'scheduled' | 'cancelled' | 'postponed' }
//     ] }
//   For each entry, sets the game's away_score/home_score (and
//   optionally status) and writes a synthetic /box_scores doc with
//   score_only:true so the public page renders an empty-lineup
//   placeholder instead of 404. Matches the provision script's
//   final-game emit shape.
//
// (B) Conflict resolution (single):
//   { leagueId, gameId, action: 'use_submission', side: 'away' | 'home' }
//   The admin picked one captain's submission as authoritative.
//   Promotes that submission's stats into /box_scores (replacing
//   anything there) and flags both submissions as resolved.
//
// All paths write an audit entry. Auto-syncs the GCal event if
// configured.

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";

const ALLOWED_STATUS = new Set([
  "scheduled",
  "final",
  "approved",
  "postponed",
  "cancelled",
]);

interface Update {
  gameId: string;
  away_score?: number;
  home_score?: number;
  status?: string;
}

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
    decoded = await getAdminAuth().verifyIdToken(idToken, true);
  } catch {
    return NextResponse.json(
      { error: "Invalid or expired token" },
      { status: 401 },
    );
  }

  let body: {
    leagueId?: unknown;
    updates?: unknown;
    gameId?: unknown;
    action?: unknown;
    side?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const leagueId = body.leagueId;
  if (typeof leagueId !== "string" || !leagueId) {
    return NextResponse.json(
      { error: "leagueId is required" },
      { status: 400 },
    );
  }
  const callerLeagues = decoded.leagues as
    | Record<string, string>
    | undefined;
  if (callerLeagues?.[leagueId] !== "admin") {
    return NextResponse.json(
      { error: `Not admin of league "${leagueId}"` },
      { status: 403 },
    );
  }

  const db = getAdminDb();

  // ── Flow (B): conflict resolution via submission promotion ────
  if (body.action === "use_submission") {
    const gameId = body.gameId;
    const side = body.side;
    if (typeof gameId !== "string" || !gameId) {
      return NextResponse.json(
        { error: "gameId is required" },
        { status: 400 },
      );
    }
    if (side !== "away" && side !== "home") {
      return NextResponse.json(
        { error: "side must be 'away' or 'home'" },
        { status: 400 },
      );
    }
    const gameSnap = await db
      .doc(`leagues/${leagueId}/games/${gameId}`)
      .get();
    if (!gameSnap.exists) {
      return NextResponse.json({ error: "Game not found" }, { status: 404 });
    }
    const game = gameSnap.data()!;
    const teamId = String(
      side === "away" ? game.away_team_id : game.home_team_id,
    );
    const subSnap = await db
      .doc(
        `leagues/${leagueId}/box_score_submissions/${gameId}_${teamId}`,
      )
      .get();
    if (!subSnap.exists) {
      return NextResponse.json(
        { error: `No submission from ${side} captain for this game` },
        { status: 404 },
      );
    }
    const sub = subSnap.data()!;
    // Captain submissions store the OWN-side score in `score`/`final_score`
    // (keyed by `side`) and the opponent's in `opp_final_score` or the sum
    // of `opp_linescore`. There is NO away_score/home_score field, so the
    // old code 400'd "missing scores" for EVERY real submission (audit H5).
    // Build both sides from the actual shape.
    const subSide: "home" | "away" = sub.side === "home" ? "home" : "away";
    const ownScore = Number(sub.score ?? sub.final_score);
    let oppScore: number;
    if (sub.opp_final_score != null) {
      oppScore = Number(sub.opp_final_score);
    } else if (Array.isArray(sub.opp_linescore) && sub.opp_linescore.length) {
      oppScore = (sub.opp_linescore as unknown[]).reduce(
        (acc: number, n) => acc + Number(n || 0),
        0,
      );
    } else {
      oppScore = NaN;
    }
    const awayScore = subSide === "away" ? ownScore : oppScore;
    const homeScore = subSide === "home" ? ownScore : oppScore;
    if (!Number.isFinite(awayScore) || !Number.isFinite(homeScore)) {
      return NextResponse.json(
        {
          error:
            "That captain's submission doesn't include both teams' scores.",
        },
        { status: 400 },
      );
    }

    // Update game doc.
    await gameSnap.ref.set(
      {
        status: "final",
        away_score: awayScore,
        home_score: homeScore,
        updated_at: new Date().toISOString(),
        updated_by_uid: decoded.uid,
      },
      { merge: true },
    );

    // Mirror to /box_scores. Promote whatever stats came with the
    // submission (lineup, batters, pitchers).
    await db.doc(`leagues/${leagueId}/box_scores/${gameId}`).set(
      {
        away_team_id: game.away_team_id,
        home_team_id: game.home_team_id,
        away_score: awayScore,
        home_score: homeScore,
        away_lineup:
          sub.side === "away" ? sub.lineup ?? [] : sub.away_lineup ?? [],
        home_lineup:
          sub.side === "home" ? sub.lineup ?? [] : sub.home_lineup ?? [],
        away_pitchers: sub.away_pitchers ?? sub.pitchers ?? [],
        home_pitchers: sub.home_pitchers ?? sub.pitchers ?? [],
        score_only: !sub.lineup || sub.lineup.length === 0,
        // Stamp status so stats recalc aggregates this box score (audit C2).
        status: "final",
        resolved_from_side: side,
        resolved_at: new Date().toISOString(),
        resolved_by_uid: decoded.uid,
      },
      { merge: true },
    );

    await db.collection(`leagues/${leagueId}/audit`).add({
      kind: "score_resolve_conflict",
      by_uid: decoded.uid,
      by_role: "admin",
      game_id: gameId,
      changes: {
        side_chosen: side,
        away_score: awayScore,
        home_score: homeScore,
      },
      at: new Date().toISOString(),
    });

    return NextResponse.json({
      ok: true,
      gameId,
      away_score: awayScore,
      home_score: homeScore,
    });
  }

  // ── Flow (A): batch quick-score entry ──────────────────────────
  if (!Array.isArray(body.updates)) {
    return NextResponse.json(
      { error: "updates array is required (or use action: 'use_submission')" },
      { status: 400 },
    );
  }
  const updates = body.updates as Update[];
  const errors: { gameId: string; error: string }[] = [];
  const written: string[] = [];

  for (const u of updates) {
    if (!u || typeof u !== "object") {
      // A null/non-object entry would throw on u.gameId before the try
      // block and 500 the whole batch, losing the other updates (audit L1).
      errors.push({ gameId: "?", error: "malformed update entry" });
      continue;
    }
    if (typeof u.gameId !== "string" || !u.gameId) {
      errors.push({ gameId: String(u.gameId ?? "?"), error: "missing gameId" });
      continue;
    }
    if (u.status != null && !ALLOWED_STATUS.has(String(u.status))) {
      errors.push({ gameId: u.gameId, error: `bad status "${u.status}"` });
      continue;
    }
    const aScore = Number(u.away_score);
    const hScore = Number(u.home_score);
    if (!Number.isFinite(aScore) || !Number.isFinite(hScore)) {
      errors.push({ gameId: u.gameId, error: "scores must be numbers" });
      continue;
    }

    try {
      const ref = db.doc(`leagues/${leagueId}/games/${u.gameId}`);
      const before = await ref.get();
      if (!before.exists) {
        errors.push({ gameId: u.gameId, error: "game not found" });
        continue;
      }
      const beforeData = before.data() ?? {};
      const newStatus = u.status ? String(u.status) : "final";
      await ref.set(
        {
          status: newStatus,
          away_score: aScore,
          home_score: hScore,
          updated_at: new Date().toISOString(),
          updated_by_uid: decoded.uid,
        },
        { merge: true },
      );

      // Synthetic box_scores doc (score-only) so the public box-score
      // page renders correctly. Mirrors the provision script.
      if (newStatus === "final" || newStatus === "approved") {
        await db.doc(`leagues/${leagueId}/box_scores/${u.gameId}`).set(
          {
            away_team_id: beforeData.away_team_id ?? "",
            home_team_id: beforeData.home_team_id ?? "",
            away_score: aScore,
            home_score: hScore,
            // The box-score reader (lib/box-score-data) checks
            // away_score_only/home_score_only — NOT *_lineup_score_only.
            // The wrong key made finalized games render "no data"/dashes
            // instead of the score-only placeholder (audit M4/M5). Also
            // stamp status so stats recalc treats it as final (audit C2).
            away_score_only: true,
            home_score_only: true,
            status: newStatus,
            updated_at: new Date().toISOString(),
            updated_by_uid: decoded.uid,
          },
          { merge: true },
        );
      }
      written.push(u.gameId);
    } catch (e) {
      errors.push({
        gameId: u.gameId,
        error: e instanceof Error ? e.message : "unknown",
      });
    }
  }

  if (written.length > 0) {
    await db.collection(`leagues/${leagueId}/audit`).add({
      kind: "score_quick_batch",
      by_uid: decoded.uid,
      by_role: "admin",
      changes: {
        count: written.length,
        game_ids: written,
      },
      at: new Date().toISOString(),
    });
  }

  return NextResponse.json({
    ok: errors.length === 0,
    written,
    errors,
  });
}
