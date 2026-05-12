// POST /api/admin-form-submission-delete
//
// Soft-delete (or restore) a form submission. Sets a `deleted` flag
// on the doc instead of removing it — Adam picked soft over hard so
// a misclick during pre-launch chaos can be undone, and the deleted
// items still appear under their own filter pill in the admin UI
// (paper trail without polluting the active inbox).
//
// Body: { leagueId, kind, id, deleted }   // deleted: true → trash,
//                                         // deleted: false → restore
//
// To actually purge a deleted doc forever, run a one-off cleanup
// script — there's no hard-delete endpoint yet, by design.

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";

const ALLOWED_KINDS = new Set([
  "team_registration",
  "player_registration",
  "team_waiver",
  "umpire_evaluation",
]);

interface Body {
  leagueId?: unknown;
  kind?: unknown;
  id?: unknown;
  deleted?: unknown;
}

export async function POST(req: Request) {
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

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const leagueId = typeof body.leagueId === "string" ? body.leagueId : "";
  const kind = typeof body.kind === "string" ? body.kind : "";
  const id = typeof body.id === "string" ? body.id : "";
  const deleted = body.deleted === true; // explicit boolean only
  if (!leagueId) {
    return NextResponse.json({ error: "leagueId required" }, { status: 400 });
  }
  if (!ALLOWED_KINDS.has(kind)) {
    return NextResponse.json({ error: `unknown kind: ${kind}` }, { status: 400 });
  }
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const claim = (decoded.leagues as Record<string, string> | undefined)?.[
    leagueId
  ];
  if (claim !== "admin") {
    return NextResponse.json({ error: "not admin" }, { status: 403 });
  }

  const db = getAdminDb();
  const docRef = db.doc(
    `leagues/${leagueId}/form_submissions/${kind}/items/${id}`,
  );
  const snap = await docRef.get();
  if (!snap.exists) {
    return NextResponse.json({ error: "submission not found" }, { status: 404 });
  }

  const nowIso = new Date().toISOString();
  if (deleted) {
    await docRef.set(
      {
        deleted: true,
        deleted_at: nowIso,
        deleted_by: decoded.uid,
      },
      { merge: true },
    );
  } else {
    // Restore — clear the deletion fields entirely so the doc looks
    // identical to one that was never deleted.
    await docRef.update({
      deleted: FieldValue.delete(),
      deleted_at: FieldValue.delete(),
      deleted_by: FieldValue.delete(),
    });
  }

  await db.collection(`leagues/${leagueId}/audit`).add({
    kind: deleted ? "form_submission_delete" : "form_submission_restore",
    by_uid: decoded.uid,
    by_email: decoded.email ?? null,
    target_kind: kind,
    target_id: id,
    at: nowIso,
  });

  return NextResponse.json({ ok: true });
}
