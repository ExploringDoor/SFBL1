// /api/admin-contacts — GET admin-only contacts dump.
//
// Returns every active player with name, jersey, position, email,
// phone, plus their team (name + division). Used by the contacts
// print/PDF page.
//
// Auth: caller must be admin of leagueId.
//
// Why a dedicated endpoint rather than letting the print page query
// /players directly: keeps the door open to migrate emails/phones
// off the public-read player doc into a `_private/{doc}` sibling
// later (see firestore.rules:104 convention) without breaking the
// print/PDF flow.

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const authHdr = req.headers.get("authorization");
  if (!authHdr?.startsWith("Bearer ")) {
    return NextResponse.json(
      { error: "Missing bearer token" },
      { status: 401 },
    );
  }
  const idToken = authHdr.slice("Bearer ".length).trim();

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

  const db = getAdminDb();
  const [teamSnap, playerSnap] = await Promise.all([
    db.collection(`leagues/${leagueId}/teams`).get(),
    db.collection(`leagues/${leagueId}/players`).get(),
  ]);

  const teams = teamSnap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      name: String(data.name ?? d.id),
      division: String(data.division ?? ""),
    };
  });

  const activePlayers = playerSnap.docs.filter(
    (d) => d.data().active !== false,
  );

  // Fetch each player's /_private/contact in parallel. PII lives
  // there now (post-migration); the public doc no longer carries
  // email/phone. For typical league sizes (≤ a few hundred players)
  // this is one Firestore read per player — well within quota.
  // Using absolute db.doc() paths (rather than d.ref.collection())
  // because some test mocks don't supply `.ref` on snapshots.
  const contactDocs = await Promise.all(
    activePlayers.map((d) =>
      db.doc(`leagues/${leagueId}/players/${d.id}/_private/contact`).get(),
    ),
  );

  const players = activePlayers.map((d, i) => {
    const data = d.data();
    const contact = contactDocs[i]!.exists ? contactDocs[i]!.data()! : {};
    return {
      id: d.id,
      team_id: String(data.team_id ?? ""),
      name: String(data.name ?? ""),
      jersey: String(data.jersey ?? ""),
      position: String(data.position ?? ""),
      email: String(contact.email ?? ""),
      phone: String(contact.phone ?? ""),
      // DOB for the admin roster's age-eligibility check (Nelson, 2026-07).
      // Same private-contact source as email/phone; admin-gated route.
      dob: String(contact.dob ?? ""),
    };
  });

  return NextResponse.json({ ok: true, teams, players });
}
