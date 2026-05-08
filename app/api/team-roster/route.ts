// /api/team-roster?leagueId=&teamId= — single team's roster with
// PII-bearing fields. Auth-gated: admin of the league OR captain of
// teamId.
//
// Why this exists: post-PII migration, /leagues/{id}/players/{id} no
// longer carries email/phone — those moved to /_private/contact.
// Captain UIs and admin UIs that show contact info can't query the
// /_private subcollection from the client (rules don't allow it for
// captains anyway). They go through this endpoint instead.

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
  const teamId = url.searchParams.get("teamId");
  if (!leagueId || !teamId) {
    return NextResponse.json(
      { error: "leagueId and teamId are required" },
      { status: 400 },
    );
  }

  const claim = (decoded.leagues as Record<string, string> | undefined)?.[
    leagueId
  ];
  const isAdmin = claim === "admin";
  const isCaptainOfTeam = claim === `captain:${teamId}`;
  if (!isAdmin && !isCaptainOfTeam) {
    return NextResponse.json(
      { error: "Not admin or captain of this team" },
      { status: 403 },
    );
  }

  const db = getAdminDb();
  const playersSnap = await db
    .collection(`leagues/${leagueId}/players`)
    .where("team_id", "==", teamId)
    .get();
  const activeDocs = playersSnap.docs.filter(
    (d) => d.data().active !== false,
  );

  const contactDocs = await Promise.all(
    activeDocs.map((d) =>
      db.doc(`leagues/${leagueId}/players/${d.id}/_private/contact`).get(),
    ),
  );

  const players = activeDocs.map((d, i) => {
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
      walk_on: data.walk_on === true,
      auth_uid: data.auth_uid ? String(data.auth_uid) : null,
    };
  });

  return NextResponse.json({ ok: true, players });
}
