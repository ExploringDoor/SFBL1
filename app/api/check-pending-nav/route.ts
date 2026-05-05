// GET /api/check-pending-nav?leagueId=X[&limit=50][&includeDismissed=false]
//
// Returns the signed-in user's pending notifications for the given
// league — what powers the in-app bell + Inbox tab. Sorted newest-
// first. Defaults to unread only (dismissed_at == null).
//
// Auth: Bearer token. The endpoint matches docs where
// `auth_uid == decoded.uid`, so a user can never see another user's
// pending_nav rows (also enforced at the rules layer for direct
// reads).

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";

export async function GET(req: Request) {
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

  const url = new URL(req.url);
  const leagueId = url.searchParams.get("leagueId");
  if (!leagueId) {
    return NextResponse.json(
      { error: "leagueId is required" },
      { status: 400 },
    );
  }
  const includeDismissed =
    url.searchParams.get("includeDismissed") === "true";
  const limit = Math.min(
    Number(url.searchParams.get("limit") ?? 50) || 50,
    200,
  );

  const db = getAdminDb();
  const snap = await db
    .collection("pending_nav")
    .where("auth_uid", "==", decoded.uid)
    .where("leagueId", "==", leagueId)
    .get();

  // Filter + sort in memory. Counts per user are bounded (a few
  // dozen at most); avoids needing a composite index for the
  // (auth_uid, leagueId, ts desc) query.
  const items = snap.docs
    .map((d) => {
      const data = d.data();
      return {
        id: d.id,
        title: String(data.title ?? ""),
        body: String(data.body ?? ""),
        url: String(data.url ?? "/"),
        category: String(data.category ?? ""),
        sourceId: data.sourceId ? String(data.sourceId) : null,
        ts: String(data.ts ?? ""),
        dismissed_at: data.dismissed_at
          ? String(data.dismissed_at)
          : null,
      };
    })
    .filter((i) => includeDismissed || !i.dismissed_at)
    .sort((a, b) => (a.ts > b.ts ? -1 : a.ts < b.ts ? 1 : 0))
    .slice(0, limit);

  const unread = items.filter((i) => !i.dismissed_at).length;

  return NextResponse.json({
    ok: true,
    items,
    unread,
  });
}
