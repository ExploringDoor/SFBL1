// GET /api/league-rosters?leagueId= — every team's roster with DOB, for
// the manager "Roster Check" tab (age-eligibility QA — catch a player who's
// too young for the division). Returns name/jersey/position/DOB only; email
// and phone stay own-team + admin (that's /api/team-roster).
//
// Two gates:
//   1. Caller must be an admin OR a captain of *any* team in the league.
//   2. The league must opt in via the `cross_team_roster_qa` feature flag
//      in its tenant config (resolved directly — /api is outside the tenant
//      middleware). Without the flag, cross-team DOB stays private — a
//      captain of a non-opted-in league gets 403 even though their claim is
//      valid.
//
// DOB lives on /_private/contact, never the public player doc, so this
// reads via the Admin SDK (batched getAll) — clients can't touch _private.

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";
import { resolveTenant } from "@/lib/tenants";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const authHdr = req.headers.get("authorization");
  if (!authHdr?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });
  }
  const idToken = authHdr.slice("Bearer ".length).trim();

  let decoded;
  try {
    decoded = await getAdminAuth().verifyIdToken(idToken);
  } catch {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }

  const leagueId = new URL(req.url).searchParams.get("leagueId");
  if (!leagueId) {
    return NextResponse.json({ error: "leagueId is required" }, { status: 400 });
  }

  // Gate 1: admin or captain of *some* team in this league.
  const claim = (decoded.leagues as Record<string, string> | undefined)?.[leagueId];
  const isAdmin = claim === "admin";
  const isCaptain = typeof claim === "string" && claim.startsWith("captain:");
  if (!isAdmin && !isCaptain) {
    return NextResponse.json(
      { error: "Not an admin or captain of this league" },
      { status: 403 },
    );
  }

  // Gate 2: the league must have opted into cross-team roster QA. API
  // routes are excluded from the tenant middleware (they do their own
  // auth), so x-tenant-config-json isn't set here — resolve the league's
  // config directly. SFBL hits the hardcoded fast-path (no read).
  const tenant = await resolveTenant({
    kind: "subdomain",
    hostname: `${leagueId}.internal`,
    slug: leagueId,
  });
  if (tenant?.config?.flags?.cross_team_roster_qa !== true) {
    return NextResponse.json(
      { error: "Cross-team roster view is not enabled for this league" },
      { status: 403 },
    );
  }

  const db = getAdminDb();
  const [teamsSnap, playersSnap] = await Promise.all([
    db.collection(`leagues/${leagueId}/teams`).get(),
    db.collection(`leagues/${leagueId}/players`).get(),
  ]);

  const teams = teamsSnap.docs
    .filter((d) => d.data().placeholder !== true) // hide the TBD placeholder
    .map((d) => ({
      id: d.id,
      name: String(d.data().name ?? d.id),
      division: String(d.data().division ?? ""),
    }));

  // Same active-player predicate the captain roster + team-roster API use,
  // so counts agree and migration orphans stay hidden.
  const activeDocs = playersSnap.docs.filter((d) => {
    const data = d.data();
    if (data.active === false) return false;
    if (data.orphan === true) return false;
    if (data.status && data.status !== "active") return false;
    return true;
  });

  // Batched read of each active player's DOB from _private/contact.
  const dobById = new Map<string, string>();
  if (activeDocs.length > 0) {
    const contactSnaps = await db.getAll(
      ...activeDocs.map((d) =>
        db.doc(`leagues/${leagueId}/players/${d.id}/_private/contact`),
      ),
    );
    contactSnaps.forEach((s, i) => {
      const id = activeDocs[i]?.id;
      if (id && s.exists) dobById.set(id, String(s.data()?.dob ?? ""));
    });
  }

  const byTeam = new Map<
    string,
    { id: string; name: string; jersey: string; position: string; dob: string }[]
  >();
  for (const d of activeDocs) {
    const data = d.data();
    const tid = String(data.team_id ?? "");
    if (!tid) continue;
    if (!byTeam.has(tid)) byTeam.set(tid, []);
    byTeam.get(tid)!.push({
      id: d.id,
      name: String(data.name ?? ""),
      jersey: String(data.jersey ?? ""),
      position: String(data.position ?? ""),
      dob: dobById.get(d.id) ?? "",
    });
  }

  const result = teams
    .map((t) => ({
      ...t,
      players: (byTeam.get(t.id) ?? []).sort(
        (a, b) =>
          (Number(a.jersey) || 999) - (Number(b.jersey) || 999) ||
          a.name.localeCompare(b.name),
      ),
    }))
    .filter((t) => t.players.length > 0)
    .sort(
      (a, b) => a.division.localeCompare(b.division) || a.name.localeCompare(b.name),
    );

  return NextResponse.json({ ok: true, teams: result });
}
