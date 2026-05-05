// POST /api/dismiss-pending-nav
//
// Body shape:
//   { leagueId: string, ids: string[] }            // dismiss specific
//   { leagueId: string, all: true }                // dismiss every unread
//
// Sets `dismissed_at` on each matching pending_nav doc, scoped to
// the caller's auth_uid + leagueId. Returns count dismissed.
//
// Auth: Bearer. Doc-level check ensures we only ever flip docs the
// caller owns.

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";

const MAX_BATCH = 400;

interface Body {
  leagueId?: unknown;
  ids?: unknown;
  all?: unknown;
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
  if (typeof leagueId !== "string" || !leagueId) {
    return NextResponse.json(
      { error: "leagueId is required" },
      { status: 400 },
    );
  }

  const db = getAdminDb();
  const nowIso = new Date().toISOString();

  let docsToDismiss: { ref: FirebaseFirestore.DocumentReference }[] = [];

  if (body.all === true) {
    const snap = await db
      .collection("pending_nav")
      .where("auth_uid", "==", decoded.uid)
      .where("leagueId", "==", leagueId)
      .get();
    docsToDismiss = snap.docs
      .filter((d) => d.data().dismissed_at == null)
      .map((d) => ({ ref: d.ref }));
  } else if (Array.isArray(body.ids)) {
    const ids = body.ids.filter(
      (x): x is string => typeof x === "string" && x.length > 0,
    );
    if (ids.length === 0) {
      return NextResponse.json(
        { error: "ids array is empty" },
        { status: 400 },
      );
    }
    // Read each doc to verify ownership before dismissing — not just
    // accepting any doc id from the body. Saves a separate rule
    // round-trip and means the user gets back exact counts even if
    // they passed strangers' ids.
    for (const id of ids) {
      const doc = await db.doc(`pending_nav/${id}`).get();
      if (!doc.exists) continue;
      const data = doc.data() ?? {};
      if (data.auth_uid !== decoded.uid) continue;
      if (data.leagueId !== leagueId) continue;
      docsToDismiss.push({ ref: doc.ref });
    }
  } else {
    return NextResponse.json(
      { error: "Body must include either { ids: [...] } or { all: true }" },
      { status: 400 },
    );
  }

  let dismissed = 0;
  for (let i = 0; i < docsToDismiss.length; i += MAX_BATCH) {
    const chunk = docsToDismiss.slice(i, i + MAX_BATCH);
    const batch = db.batch();
    for (const d of chunk) {
      batch.set(d.ref, { dismissed_at: nowIso }, { merge: true });
    }
    await batch.commit();
    dismissed += chunk.length;
  }

  return NextResponse.json({ ok: true, dismissed });
}
