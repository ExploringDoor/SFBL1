// GET /api/admin-audit-log?leagueId=X[&limit=100][&kind=schedule_edit]
//
// Reads /leagues/{leagueId}/audit, sorted newest-first. Enriches each
// row with the actor's email by resolving by_uid → Auth user. Used
// by the admin Audit Log section to answer "who edited that game?"
// without sshing into Firestore.
//
// Auth: caller must be admin of the target league.
//
// Why server-side: /audit is admin-read only at the rules layer
// (firestore.rules:155-169). Plus the uid→email enrichment requires
// Admin SDK access to Firebase Auth.

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

  const callerLeagues = decoded.leagues as
    | Record<string, string>
    | undefined;
  if (callerLeagues?.[leagueId] !== "admin") {
    return NextResponse.json(
      { error: `Not admin of league "${leagueId}"` },
      { status: 403 },
    );
  }

  const limit = Math.min(
    Number(url.searchParams.get("limit") ?? 100) || 100,
    500,
  );
  const kindFilter = url.searchParams.get("kind"); // optional filter

  const db = getAdminDb();
  const snap = await db
    .collection(`leagues/${leagueId}/audit`)
    .get();

  // Filter + sort in memory. Audit volume per league is bounded
  // (a few hundred entries per season at most), so we don't need a
  // composite index for (kind, at desc).
  const entries = snap.docs
    .map((d) => {
      const data = d.data();
      return {
        id: d.id,
        kind: String(data.kind ?? ""),
        by_uid: data.by_uid ? String(data.by_uid) : null,
        by_role: data.by_role ? String(data.by_role) : null,
        game_id: data.game_id ? String(data.game_id) : null,
        changes:
          (data.changes as Record<string, unknown> | undefined) ?? {},
        at: String(data.at ?? ""),
      };
    })
    .filter((e) => !kindFilter || e.kind === kindFilter)
    .sort((a, b) => (a.at > b.at ? -1 : a.at < b.at ? 1 : 0))
    .slice(0, limit);

  // Enrich with by_uid → email. Batch lookups (up to 100 per call
  // per Firebase Admin Auth's getUsers limit).
  const adminAuth = getAdminAuth();
  const uniqueUids = [
    ...new Set(
      entries
        .map((e) => e.by_uid)
        .filter((u): u is string => typeof u === "string" && u.length > 0),
    ),
  ];
  const uidToEmail = new Map<string, string>();
  for (let i = 0; i < uniqueUids.length; i += 100) {
    const batch = uniqueUids.slice(i, i + 100).map((uid) => ({ uid }));
    try {
      const result = await adminAuth.getUsers(batch);
      for (const u of result.users) {
        if (u.email) uidToEmail.set(u.uid, u.email);
      }
    } catch {
      // best effort — uids without an enriched email show as raw uid
    }
  }

  const enriched = entries.map((e) => ({
    ...e,
    by_email: e.by_uid ? (uidToEmail.get(e.by_uid) ?? null) : null,
  }));

  return NextResponse.json({
    ok: true,
    items: enriched,
    total: snap.size,
  });
}
