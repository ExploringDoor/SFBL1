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
import { assessPlayer, needsConsent, type MinorsPolicy } from "@/lib/minors";

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
  // Drop orphan / inactive docs the same way the captain UI does.
  // The previous filter only checked `active !== false` which let
  // LBDC's migration-created orphans (status: "unknown",
  // orphan: true, no `active` field) slip through — that's why
  // Brooklyn was showing 154 players. Identical predicate to the
  // client-side filters so the captain RosterTab and the API agree.
  const activeDocs = playersSnap.docs.filter((d) => {
    const data = d.data();
    if (data.active === false) return false;
    if (data.orphan === true) return false;
    if (data.status && data.status !== "active") return false;
    return true;
  });

  const contactDocs = await Promise.all(
    activeDocs.map((d) =>
      db.doc(`leagues/${leagueId}/players/${d.id}/_private/contact`).get(),
    ),
  );

  // Minor status is DERIVED HERE, on every read, and never stored.
  //
  // Storing a stamped age is the trap the older STS implementation fell into:
  // the number is written once and then silently goes stale the moment the
  // season rolls over. Deriving on read means the answer is always computed
  // against the current season's cutoff, and — just as important — nothing
  // age-related ever has to be written to the world-readable player doc.
  const leagueSnap = await db.doc(`leagues/${leagueId}`).get();
  const policy = (leagueSnap.data()?.minors ?? null) as MinorsPolicy | null;
  // Season year for the cutoff: the tenant's branded season year when set,
  // otherwise the calendar year.
  const seasonYear =
    typeof leagueSnap.data()?.season_year === "number"
      ? (leagueSnap.data()!.season_year as number)
      : new Date().getFullYear();

  const assess = (dob: unknown) =>
    assessPlayer(typeof dob === "string" ? dob : null, policy, seasonYear);

  const players = activeDocs.map((d, i) => {
    const data = d.data();
    const contact = contactDocs[i]!.exists ? contactDocs[i]!.data()! : {};
    const age = assess(contact.dob);
    return {
      id: d.id,
      team_id: String(data.team_id ?? ""),
      name: String(data.name ?? ""),
      jersey: String(data.jersey ?? ""),
      position: String(data.position ?? ""),
      email: String(contact.email ?? ""),
      phone: String(contact.phone ?? ""),
      // DOB is PII — lives only on the _private/contact subdoc, never
      // the public player doc. Returned here for the captain/manager
      // roster view (this endpoint is already admin/captain-gated and
      // reads via the Admin SDK). Not exposed on any public surface.
      dob: String(contact.dob ?? ""),
      walk_on: data.walk_on === true,
      auth_uid: data.auth_uid ? String(data.auth_uid) : null,
      // Derived, never stored. `status` is "adult" | "minor" |
      // "under_minimum" | "unknown"; a missing DOB is "unknown", NOT "adult",
      // so the gap surfaces for follow-up instead of reading as fine.
      minor_status: age.status,
      age_at_cutoff: age.age,
      cutoff_date: age.cutoffDate,
      needs_consent: needsConsent(age, policy),
      consent_on_file: contact.consent_on_file === true,
      consent_recorded_at: contact.consent_recorded_at
        ? String(contact.consent_recorded_at)
        : null,
    };
  });

  return NextResponse.json({ ok: true, players });
}
