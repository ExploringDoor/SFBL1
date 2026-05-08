// /api/live-score — incremental score updates from the field-side
// scorekeeper. Tap-driven: each tap = +1 run for one team, or
// "next half-inning", or "final".
//
// Auth: caller must be admin of the league OR captain of one of
// the two teams in the game. (Fans of either team can score-keep,
// not just the home team's captain.)
//
// Body shapes:
//   { leagueId, gameId, action: "run", side: "away" | "home", delta?: 1|-1 }
//   { leagueId, gameId, action: "set_score", away_score, home_score }
//   { leagueId, gameId, action: "advance_inning", half?: "top" | "bottom" }
//   { leagueId, gameId, action: "set_inning", inning: number, half: "top"|"bottom" }
//   { leagueId, gameId, action: "go_live" }
//   { leagueId, gameId, action: "finalize" }
//   { leagueId, gameId, action: "undo_final" }   // back to live
//
// All writes go through this endpoint (not direct Firestore client
// writes) so we can stamp updated_at + audit trail consistently.

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";

interface Body {
  leagueId?: unknown;
  gameId?: unknown;
  action?: unknown;
  side?: unknown;
  delta?: unknown;
  away_score?: unknown;
  home_score?: unknown;
  inning?: unknown;
  half?: unknown;
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
    decoded = await getAdminAuth().verifyIdToken(idToken);
  } catch {
    return NextResponse.json(
      { error: "Invalid or expired token" },
      { status: 401 },
    );
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const leagueId = body.leagueId;
  const gameId = body.gameId;
  const action = body.action;
  if (typeof leagueId !== "string" || !leagueId) {
    return NextResponse.json(
      { error: "leagueId is required" },
      { status: 400 },
    );
  }
  if (typeof gameId !== "string" || !gameId) {
    return NextResponse.json(
      { error: "gameId is required" },
      { status: 400 },
    );
  }

  const db = getAdminDb();
  const ref = db.doc(`leagues/${leagueId}/games/${gameId}`);
  const snap = await ref.get();
  if (!snap.exists) {
    return NextResponse.json({ error: "Game not found" }, { status: 404 });
  }
  const game = snap.data() ?? {};

  // Authority: admin OR captain of either team.
  const claim = (decoded.leagues as Record<string, string> | undefined)?.[
    leagueId
  ];
  const isAdmin = claim === "admin";
  const captainTeam =
    typeof claim === "string" && claim.startsWith("captain:")
      ? claim.slice("captain:".length)
      : null;
  const isCaptainOfThisGame =
    !!captainTeam &&
    (captainTeam === game.away_team_id ||
      captainTeam === game.home_team_id);
  if (!isAdmin && !isCaptainOfThisGame) {
    return NextResponse.json(
      { error: "Not admin or captain of either team in this game" },
      { status: 403 },
    );
  }

  const now = new Date().toISOString();
  const update: Record<string, unknown> = {
    updated_at: now,
    updated_by_uid: decoded.uid,
  };

  switch (action) {
    case "go_live": {
      update.status = "live";
      update.live_started_at = now;
      // Reset to 0-0 top of 1 only if not already live (don't clobber
      // an in-progress game's score on accidental re-tap).
      if (game.status !== "live") {
        update.away_score = Number(game.away_score) || 0;
        update.home_score = Number(game.home_score) || 0;
        update.current_inning = 1;
        update.current_half = "top";
      }
      break;
    }
    case "run": {
      const side = body.side;
      const deltaRaw = body.delta;
      const delta = deltaRaw === -1 ? -1 : 1;
      if (side !== "away" && side !== "home") {
        return NextResponse.json(
          { error: "side must be away or home" },
          { status: 400 },
        );
      }
      const key = `${side}_score`;
      const cur = Number(game[key]) || 0;
      const next = Math.max(0, cur + delta);
      update[key] = next;
      // Auto-flip to live if not already (admin scorekeeping a game
      // that was sitting at scheduled).
      if (game.status !== "live") update.status = "live";
      break;
    }
    case "set_score": {
      const a = Number(body.away_score);
      const h = Number(body.home_score);
      if (!Number.isFinite(a) || !Number.isFinite(h) || a < 0 || h < 0) {
        return NextResponse.json(
          { error: "away_score and home_score must be non-negative numbers" },
          { status: 400 },
        );
      }
      update.away_score = a;
      update.home_score = h;
      if (game.status !== "live") update.status = "live";
      break;
    }
    case "advance_inning": {
      const inning = Number(game.current_inning) || 1;
      const half = String(game.current_half ?? "top");
      if (half === "top") {
        update.current_half = "bottom";
      } else {
        update.current_inning = inning + 1;
        update.current_half = "top";
      }
      break;
    }
    case "set_inning": {
      const inning = Number(body.inning);
      const half = body.half;
      if (!Number.isFinite(inning) || inning < 1 || inning > 30) {
        return NextResponse.json(
          { error: "inning must be a number 1-30" },
          { status: 400 },
        );
      }
      if (half !== "top" && half !== "bottom") {
        return NextResponse.json(
          { error: "half must be 'top' or 'bottom'" },
          { status: 400 },
        );
      }
      update.current_inning = inning;
      update.current_half = half;
      break;
    }
    case "finalize": {
      update.status = "final";
      update.live_ended_at = now;
      break;
    }
    case "undo_final": {
      update.status = "live";
      update.live_ended_at = null;
      break;
    }
    default:
      return NextResponse.json(
        { error: "Invalid action" },
        { status: 400 },
      );
  }

  await ref.set(update, { merge: true });

  return NextResponse.json({
    ok: true,
    game: {
      ...game,
      ...update,
    },
  });
}
