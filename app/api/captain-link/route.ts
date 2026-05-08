// POST /api/captain-link — auto-link the calling captain's auth user
// to a player record on their team, by email match.
//
// Verbatim behaviour port of DVSL captain.html's _backfillCaptainPlayerLink
// (lines 1990–2024). Runs server-side because /players is admin-write
// only at the rules level — we don't want to widen those rules to
// allow client-driven writes.
//
// Logic:
//   1. Verify Firebase auth bearer.
//   2. Confirm the user has `captain:<team_id>` claim for the league.
//   3. Read all players on that team. Find email matches.
//      - 0 matches → no-op (manual claim flow). Returns { matches: 0 }.
//      - 2+ matches → no-op (ambiguous, admin picks). Returns { matches: N }.
//      - 1 match  → if not already linked to this uid, write
//        `auth_uid` + `email` and return { linked: playerId }.

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";

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

  let body: { leagueId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }
  const leagueId = body.leagueId;
  if (typeof leagueId !== "string" || !leagueId) {
    return NextResponse.json(
      { error: "Body must include { leagueId }" },
      { status: 400 },
    );
  }

  const leagues = decoded.leagues as Record<string, string> | undefined;
  const claim = leagues?.[leagueId];
  if (typeof claim !== "string" || !claim.startsWith("captain:")) {
    return NextResponse.json(
      { error: "Not a captain in this league" },
      { status: 403 },
    );
  }
  const teamId = claim.slice("captain:".length);

  const email = (decoded.email ?? "").toLowerCase();
  if (!email) {
    return NextResponse.json({ matches: 0, reason: "no email on token" });
  }

  const db = getAdminDb();
  const playersSnap = await db
    .collection(`leagues/${leagueId}/players`)
    .where("team_id", "==", teamId)
    .get();

  // Email lives on the /_private/contact subdoc post-PII migration —
  // batch-fetch contact docs and look for matches.
  const activeDocs = playersSnap.docs.filter(
    (d) => d.data().active !== false,
  );
  const contactDocs = await Promise.all(
    activeDocs.map((d) =>
      db.doc(`leagues/${leagueId}/players/${d.id}/_private/contact`).get(),
    ),
  );

  const matches: { id: string; authUid?: string }[] = [];
  for (let i = 0; i < activeDocs.length; i++) {
    const d = activeDocs[i]!;
    const p = d.data();
    const contact = contactDocs[i]!.exists ? contactDocs[i]!.data()! : {};
    const peml = String(contact.email ?? "").toLowerCase();
    if (!peml || peml !== email) continue;
    // Skip if linked to a different uid — would clobber someone else.
    if (p.auth_uid && p.auth_uid !== decoded.uid) continue;
    matches.push({ id: d.id, authUid: p.auth_uid });
  }

  if (matches.length === 0) {
    return NextResponse.json({ matches: 0 });
  }
  if (matches.length > 1) {
    return NextResponse.json({ matches: matches.length, ambiguous: true });
  }
  const match = matches[0]!;
  if (match.authUid === decoded.uid) {
    return NextResponse.json({ matches: 1, alreadyLinked: true });
  }

  // Public doc gets the auth_uid linkage; email itself stays in the
  // private contact subdoc.
  await db
    .doc(`leagues/${leagueId}/players/${match.id}`)
    .set({ auth_uid: decoded.uid }, { merge: true });
  await db
    .doc(`leagues/${leagueId}/players/${match.id}/_private/contact`)
    .set({ email }, { merge: true });

  return NextResponse.json({ matches: 1, linked: match.id });
}
