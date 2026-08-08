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
import { assessPlayer, needsConsent, type MinorsPolicy } from "@/lib/minors";
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

  // Minor status, derived per request and never stored — see lib/minors.ts.
  // The league doc carries the policy; the cutoff is evaluated inside the
  // current season year, so a player who turns 18 becomes an adult on the next
  // page load with no recompute job and no stale stamped value anywhere.
  const leagueSnap = await db.doc(`leagues/${leagueId}`).get();
  const policy = (leagueSnap.data()?.minors ?? null) as MinorsPolicy | null;
  const seasonYear =
    typeof leagueSnap.data()?.season_year === "number"
      ? (leagueSnap.data()!.season_year as number)
      : new Date().getFullYear();

  const players = activePlayers.map((d, i) => {
    const data = d.data();
    const contact = contactDocs[i]!.exists ? contactDocs[i]!.data()! : {};
    const age = assessPlayer(
      typeof contact.dob === "string" ? contact.dob : null,
      policy,
      seasonYear,
    );
    return {
      id: d.id,
      team_id: String(data.team_id ?? ""),
      name: String(data.name ?? ""),
      jersey: String(data.jersey ?? ""),
      position: String(data.position ?? ""),
      email: String(contact.email ?? ""),
      phone: String(contact.phone ?? ""),
      minor_status: age.status,
      age_at_cutoff: age.age,
      cutoff_date: age.cutoffDate,
      needs_consent: needsConsent(age, policy),
      consent_on_file: contact.consent_on_file === true,
    };
  });

  return NextResponse.json({
    ok: true,
    teams,
    players,
    minors_policy: policy,
  });
}
