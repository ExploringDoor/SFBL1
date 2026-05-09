// Admin-only intake reader for the four public forms
// (player_registration, team_registration, team_waiver,
// umpire_evaluation). Lists submissions in reverse-chronological
// order. No edit/delete here — admin reviews + acts manually.
//
// Auth: same pattern as the other /api/admin-* endpoints —
// verifies the caller has the `leagues.{leagueId}: "admin"` claim
// before reading.

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";

const ALLOWED_KINDS = new Set([
  "team_registration",
  "player_registration",
  "team_waiver",
  "umpire_evaluation",
]);

export async function GET(req: Request) {
  const url = new URL(req.url);
  const leagueId = url.searchParams.get("leagueId");
  const kind = url.searchParams.get("kind") ?? "";
  const limit = Math.min(
    Math.max(parseInt(url.searchParams.get("limit") ?? "100", 10) || 100, 1),
    500,
  );
  if (!leagueId) {
    return NextResponse.json({ error: "leagueId required" }, { status: 400 });
  }
  if (!ALLOWED_KINDS.has(kind)) {
    return NextResponse.json(
      { error: `unknown kind: ${kind}` },
      { status: 400 },
    );
  }

  const authHeader = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/.exec(authHeader);
  if (!m) {
    return NextResponse.json({ error: "missing bearer" }, { status: 401 });
  }
  let decoded;
  try {
    decoded = await getAdminAuth().verifyIdToken(m[1]!);
  } catch {
    return NextResponse.json({ error: "invalid token" }, { status: 401 });
  }
  const claim = (decoded.leagues as Record<string, string> | undefined)?.[
    leagueId
  ];
  if (claim !== "admin") {
    return NextResponse.json({ error: "not admin" }, { status: 403 });
  }

  const db = getAdminDb();
  const snap = await db
    .collection(`leagues/${leagueId}/form_submissions/${kind}/items`)
    .orderBy("submitted_at", "desc")
    .limit(limit)
    .get();

  const items = snap.docs.map((d) => {
    const data = d.data();
    // Strip volatile diagnostic fields from the response. ip +
    // user_agent are written for spam triage but the admin UI
    // doesn't need them; surfacing them just clutters the view.
    const { ip: _ip, user_agent: _ua, ...rest } = data;
    return { id: d.id, ...rest };
  });

  return NextResponse.json({ items });
}
