// POST /api/admin-resolve-score
//
// Mike's final say on a disputed score. He picks the correct numbers, the game
// goes back on the site as final, and the dispute closes.
//
// Body: { leagueId, disputeId, home_score, away_score }
//    or { leagueId, disputeId, action: "dismiss" } to close without a result
//       (the game returns to unplayed).

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const m = /^Bearer\s+(.+)$/.exec(req.headers.get("authorization") ?? "");
  if (!m) return NextResponse.json({ error: "missing bearer" }, { status: 401 });
  let decoded;
  try {
    decoded = await getAdminAuth().verifyIdToken(m[1]!);
  } catch {
    return NextResponse.json({ error: "invalid token" }, { status: 401 });
  }

  let body: {
    leagueId?: unknown;
    disputeId?: unknown;
    home_score?: unknown;
    away_score?: unknown;
    action?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const leagueId = typeof body.leagueId === "string" ? body.leagueId : "";
  const disputeId = typeof body.disputeId === "string" ? body.disputeId : "";
  if (!leagueId || !disputeId) {
    return NextResponse.json({ error: "leagueId and disputeId required" }, { status: 400 });
  }
  if ((decoded.leagues as Record<string, string> | undefined)?.[leagueId] !== "admin") {
    return NextResponse.json({ error: "not admin" }, { status: 403 });
  }

  const db = getAdminDb();
  const dRef = db.doc(`leagues/${leagueId}/score_disputes/${disputeId}`);
  const dSnap = await dRef.get();
  if (!dSnap.exists) {
    return NextResponse.json({ error: "dispute not found" }, { status: 404 });
  }
  const dispute = dSnap.data() ?? {};
  const gameId = String(dispute.game_id ?? "");
  const now = new Date().toISOString();

  if (body.action === "dismiss") {
    await dRef.set(
      { status: "dismissed", resolved_at: now, resolved_by: decoded.uid },
      { merge: true },
    );
    if (gameId) {
      await db.doc(`leagues/${leagueId}/games/${gameId}`).set(
        { score_disputed: false },
        { merge: true },
      );
    }
    return NextResponse.json({ ok: true, dismissed: true });
  }

  const home = Number(body.home_score);
  const away = Number(body.away_score);
  if (!Number.isInteger(home) || !Number.isInteger(away) || home < 0 || away < 0) {
    return NextResponse.json(
      { error: "home_score and away_score must be whole numbers, 0 or more" },
      { status: 400 },
    );
  }
  if (!gameId) {
    return NextResponse.json({ error: "dispute has no game" }, { status: 400 });
  }

  await db.doc(`leagues/${leagueId}/games/${gameId}`).set(
    {
      home_score: home,
      away_score: away,
      status: "final",
      score_disputed: false,
      score_source: "office",
      score_updated_at: now,
    },
    { merge: true },
  );
  await dRef.set(
    {
      status: "resolved",
      official: { home_score: home, away_score: away },
      resolved_at: now,
      resolved_by: decoded.uid,
    },
    { merge: true },
  );
  await db.collection(`leagues/${leagueId}/audit`).add({
    kind: "score_dispute_resolved",
    at: now,
    by_uid: decoded.uid,
    game_id: gameId,
    home_score: home,
    away_score: away,
  });

  return NextResponse.json({ ok: true, resolved: true });
}
