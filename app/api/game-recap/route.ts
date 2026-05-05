// POST /api/game-recap — admin or one of the two captains in a game
// posts an override recap. Stored at /leagues/{leagueId}/recaps/{gameId}.
// The public game page falls back to the auto-generated recap from
// box-score data when no override exists.
//
// Body:
//   { leagueId, gameId, markdown }     // upsert
//   { leagueId, gameId, clear: true }  // delete the override (revert to auto)
//
// Authority: caller must be admin OR captain whose team_id matches
// either game.away_team_id or game.home_team_id.
//
// Markdown is sanitized via the same markdownToHtml() pipeline used
// for /page-content. Cap at 8KB — recaps shouldn't be essays.

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";
import { markdownToHtml } from "@/lib/markdown";

export const runtime = "nodejs";

const MAX_MARKDOWN_BYTES = 8_000;

interface Body {
  leagueId?: unknown;
  gameId?: unknown;
  markdown?: unknown;
  clear?: unknown;
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

  const leagues = decoded.leagues as Record<string, string> | undefined;
  const claim = leagues?.[leagueId];
  let captainTeamId: string | null = null;
  let isAdmin = false;
  if (claim === "admin") {
    isAdmin = true;
  } else if (typeof claim === "string" && claim.startsWith("captain:")) {
    captainTeamId = claim.slice("captain:".length);
  } else {
    return NextResponse.json(
      { error: `No role in league "${leagueId}"` },
      { status: 403 },
    );
  }

  const db = getAdminDb();

  // Verify the game exists + the caller (if captain) actually plays
  // in it. Don't let a captain of an unrelated team rewrite history.
  const gameSnap = await db.doc(`leagues/${leagueId}/games/${gameId}`).get();
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

  const ref = db.doc(`leagues/${leagueId}/recaps/${gameId}`);

  if (body.clear === true) {
    await ref.delete().catch(() => {
      /* idempotent */
    });
    return NextResponse.json({ ok: true, cleared: true });
  }

  if (typeof body.markdown !== "string") {
    return NextResponse.json(
      { error: "markdown is required (or clear: true)" },
      { status: 400 },
    );
  }
  const markdown = body.markdown;
  if (Buffer.byteLength(markdown, "utf8") > MAX_MARKDOWN_BYTES) {
    return NextResponse.json(
      { error: `markdown exceeds ${MAX_MARKDOWN_BYTES}-byte limit` },
      { status: 413 },
    );
  }

  const html = markdownToHtml(markdown);
  await ref.set(
    {
      markdown,
      html,
      updated_at: new Date().toISOString(),
      updated_by_uid: decoded.uid,
      updated_by_role: isAdmin ? "admin" : `captain:${captainTeamId}`,
    },
    { merge: true },
  );

  return NextResponse.json({ ok: true, bytes: markdown.length });
}
