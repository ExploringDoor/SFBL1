// POST /api/player-link — auto-link the calling user's auth uid to a
// player record on this league by email match.
//
// Mirrors /api/captain-link but for ANY signed-in user, not just
// captains. The /profile page calls this on mount so a player who
// magic-link-signs-in for the first time gets their player record
// linked → they can mark their own availability.
//
// Logic:
//   1. Verify Firebase auth bearer.
//   2. Read all players in this league where email === decoded.email.
//   3. If 0 matches: no-op (no player record exists for this email,
//      probably a fan / guest).
//   4. If 2+ matches: ambiguous — return matches count + ambiguity
//      flag. Player has to ask the captain to disambiguate (e.g.
//      they're rostered on multiple teams from past seasons; pick
//      which one is current). Don't auto-link to avoid clobbering.
//   5. If 1 match: write `auth_uid` + `email` on the player doc.
//
// Idempotent — no-op if already linked.
//
// Public-write workaround: /players is admin-write at the rules
// level. Admin SDK bypass via this endpoint is the platform pattern
// for "let signed-in users self-link their player record" flows.

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
      { error: "leagueId is required" },
      { status: 400 },
    );
  }

  const email = (decoded.email ?? "").toLowerCase();
  if (!email) {
    return NextResponse.json({ matches: 0, reason: "no email on token" });
  }

  const db = getAdminDb();
  // Email lives on /_private/contact subdocs post-PII migration. We
  // walk the league's player docs and fetch each contact in
  // parallel, looking for matches. For typical league sizes (≤ a
  // few hundred players) this is one query + N parallel reads —
  // well within Firestore's per-request budget. (Avoids
  // collectionGroup so the test mock layer doesn't need to model
  // cross-collection queries.)
  const playersSnap = await db
    .collection(`leagues/${leagueId}/players`)
    .get();
  const candidates = playersSnap.docs.filter((d) => {
    const p = d.data();
    if (p.active === false) return false;
    if (p.auth_uid && p.auth_uid !== decoded.uid) return false;
    return true;
  });
  const contactSnaps = await Promise.all(
    candidates.map((d) =>
      db
        .doc(`leagues/${leagueId}/players/${d.id}/_private/contact`)
        .get(),
    ),
  );
  const matches: { id: string; team_id: string; alreadyLinked: boolean }[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const contact = contactSnaps[i]!.exists ? contactSnaps[i]!.data()! : {};
    const peml = String(contact.email ?? "").toLowerCase();
    if (!peml || peml !== email) continue;
    const p = candidates[i]!.data();
    matches.push({
      id: candidates[i]!.id,
      team_id: String(p.team_id ?? ""),
      alreadyLinked: p.auth_uid === decoded.uid,
    });
  }

  if (matches.length === 0) {
    return NextResponse.json({ matches: 0 });
  }
  if (matches.length > 1) {
    return NextResponse.json({
      matches: matches.length,
      ambiguous: true,
      candidates: matches.map((m) => ({ id: m.id, team_id: m.team_id })),
    });
  }
  const match = matches[0]!;
  if (match.alreadyLinked) {
    return NextResponse.json({
      matches: 1,
      alreadyLinked: true,
      player_id: match.id,
      team_id: match.team_id,
    });
  }

  // Public doc gets auth_uid; email stays in /_private/contact.
  await db.doc(`leagues/${leagueId}/players/${match.id}`).set(
    { auth_uid: decoded.uid },
    { merge: true },
  );
  await db
    .doc(`leagues/${leagueId}/players/${match.id}/_private/contact`)
    .set({ email }, { merge: true });

  return NextResponse.json({
    matches: 1,
    linked: match.id,
    team_id: match.team_id,
  });
}
