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

  // Closes H8. Old comment claimed "audit volume per league is
  // bounded (a few hundred entries per season at most)" — but the
  // log accumulates every admin action across all seasons forever
  // with no rotation. By season 3 every admin dashboard load
  // downloads thousands of docs. Move the sort/filter/limit to
  // Firestore: single-field `at` index covers the no-filter path,
  // and the rare `?kind=` filtered path uses the auto-indexed
  // `kind` filter then orders by `at` (Firestore requires the
  // filtered field to come first; this is single-field for `kind`
  // + single-field for `at` chained — no composite needed because
  // we limit and accept a small extra scan when filtering).
  const db = getAdminDb();
  let query = db
    .collection(`leagues/${leagueId}/audit`)
    .orderBy("at", "desc") as FirebaseFirestore.Query;
  if (kindFilter) {
    // `where + orderBy` on different fields requires a composite
    // index when both are inequality/range — `kind` here is
    // equality, so Firestore composes the two single-field indexes
    // and serves the query without a new declared composite.
    query = db
      .collection(`leagues/${leagueId}/audit`)
      .where("kind", "==", kindFilter)
      .orderBy("at", "desc");
  }
  const snap = await query.limit(limit).get();

  const entries = snap.docs.map((d) => {
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
  });

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

// DELETE /api/admin-audit-log?leagueId=X[&olderThanDays=30]
//
// Clears audit entries. Without `olderThanDays`, deletes ALL entries
// for the league — equivalent to DVSL's "Clear All" button. With
// `olderThanDays=30`, only deletes entries older than that cutoff
// (less destructive — keeps the recent activity for context).
//
// Audit log retention is at the commissioner's discretion. Compliance-
// minded leagues can leave it untouched (Firestore is cheap for
// this volume); leagues that just want a clean slate after season
// end can wipe it.
export async function DELETE(req: Request) {
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

  const olderThanDaysRaw = url.searchParams.get("olderThanDays");
  const olderThanDays =
    olderThanDaysRaw && Number.isFinite(Number(olderThanDaysRaw))
      ? Number(olderThanDaysRaw)
      : null;
  const cutoffIso =
    olderThanDays != null
      ? new Date(Date.now() - olderThanDays * 86_400_000).toISOString()
      : null;

  const db = getAdminDb();
  const snap = await db.collection(`leagues/${leagueId}/audit`).get();
  const docsToDelete = snap.docs.filter((d) => {
    if (cutoffIso == null) return true;
    const at = String(d.data().at ?? "");
    return at && at < cutoffIso;
  });

  // Batch deletes — Firestore limits to 500 ops per batch. For audit
  // volumes this is a single batch in practice (per-season cap is
  // a few hundred), but loop anyway so we don't break later.
  let deleted = 0;
  for (let i = 0; i < docsToDelete.length; i += 450) {
    const batch = db.batch();
    for (const d of docsToDelete.slice(i, i + 450)) {
      batch.delete(d.ref);
    }
    await batch.commit();
    deleted += Math.min(450, docsToDelete.length - i);
  }

  return NextResponse.json({
    ok: true,
    deleted,
    total_before: snap.size,
    total_after: snap.size - deleted,
  });
}
