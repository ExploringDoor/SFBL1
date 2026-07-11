// POST /api/admin-form-submission-status
//
// Admin-only mutation: set the workflow status of a single form
// submission. The submissions themselves are written by the public
// /api/league-form endpoint and don't carry a status field (the UI
// treats missing → "new"). Once Nelson starts acting on a submission
// (emailing for payment, granting a roster spot, etc.) the admin
// inbox needs a way to remember where things stand. Three states:
//
//   - new           default for any submission with no status set
//   - in_progress   Nelson has reached out / is waiting on something
//   - done          payment received, roster updated, no further action
//
// No undo / history — flipping back to "new" or "in_progress" is a
// no-op apart from the new state. A reviewer can always reopen.
//
// Audit: every status flip writes to /leagues/{id}/audit, mirroring
// other admin mutations so we have forensics if a submission state
// is disputed (rare but cheap insurance).
//
// Body: { leagueId, kind, id, status }

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";

const ALLOWED_KINDS = new Set([
  "team_registration",
  "player_registration",
  "team_waiver",
  "umpire_evaluation",
]);

const ALLOWED_STATUSES = new Set(["new", "in_progress", "done"]);

interface Body {
  leagueId?: unknown;
  kind?: unknown;
  id?: unknown;
  status?: unknown;
}

export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/.exec(authHeader);
  if (!m) {
    return NextResponse.json({ error: "missing bearer" }, { status: 401 });
  }
  let decoded;
  try {
    decoded = await getAdminAuth().verifyIdToken(m[1]!, true);
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
  const status = typeof body.status === "string" ? body.status : "";
  if (!leagueId) {
    return NextResponse.json({ error: "leagueId required" }, { status: 400 });
  }
  if (!ALLOWED_KINDS.has(kind)) {
    return NextResponse.json({ error: `unknown kind: ${kind}` }, { status: 400 });
  }
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }
  if (!ALLOWED_STATUSES.has(status)) {
    return NextResponse.json(
      { error: `status must be one of: new | in_progress | done` },
      { status: 400 },
    );
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
  await docRef.set(
    {
      status,
      status_updated_at: nowIso,
      status_updated_by: decoded.uid,
    },
    { merge: true },
  );

  // Light-weight audit entry.
  await db.collection(`leagues/${leagueId}/audit`).add({
    kind: "form_submission_status",
    by_uid: decoded.uid,
    by_email: decoded.email ?? null,
    target_kind: kind,
    target_id: id,
    status,
    at: nowIso,
  });

  return NextResponse.json({ ok: true });
}
