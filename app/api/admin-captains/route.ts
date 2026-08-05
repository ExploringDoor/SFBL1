// POST /api/admin-captains — one consolidated roster of every team's
// captain(s) for the admin: contact on file, whether a team password
// is set, and when the captain last logged in. Adam wanted a single
// screen instead of expanding team-by-team in the Teams tab
// (2026-05-18).
//
// Aggregates three sources server-side (Admin SDK, one round trip):
//   - teams/{id}                      → name, has_captain_password
//   - teams/{id}/_private/contact     → { managers: [{name,email}] }
//   - audit (kind=public_captain_claim) → last login per team
//
// Body: { leagueId }
// Response: { ok, captains: [{ teamId, teamName, managers,
//             hasPassword, code, lastLogin }] }
//
// Admin-only (verified claim). Read-only.

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });
  }
  let decoded;
  try {
    decoded = await getAdminAuth().verifyIdToken(
      auth.slice("Bearer ".length).trim(),
    );
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
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const leagueId = body.leagueId;
  if (typeof leagueId !== "string" || !leagueId) {
    return NextResponse.json({ error: "leagueId required" }, { status: 400 });
  }
  const leagues = decoded.leagues as Record<string, string> | undefined;
  if (leagues?.[leagueId] !== "admin") {
    return NextResponse.json(
      { error: `Not admin of league "${leagueId}"` },
      { status: 403 },
    );
  }

  const db = getAdminDb();

  // Teams + the last-login audit, in parallel.
  const [teamsSnap, auditSnap] = await Promise.all([
    db.collection(`leagues/${leagueId}/teams`).get(),
    db
      .collection(`leagues/${leagueId}/audit`)
      .where("kind", "==", "public_captain_claim")
      .get(),
  ]);

  // Reduce audit rows → most-recent login per team.
  const lastLogin: Record<string, string> = {};
  for (const d of auditSnap.docs) {
    const x = d.data();
    const tid = String(x.team_id ?? "");
    const at = String(x.at ?? "");
    if (!tid || !at) continue;
    if (!lastLogin[tid] || at > lastLogin[tid]) lastLogin[tid] = at;
  }

  const teams = teamsSnap.docs.filter((d) => d.data().active !== false);

  // Each team's private contact subdoc, in parallel.
  const contacts = await Promise.all(
    teams.map((d) =>
      db.doc(`leagues/${leagueId}/teams/${d.id}/_private/contact`).get(),
    ),
  );

  // The team's sign-in code. Doug has to be able to read this back to a coach
  // who has lost their welcome email, so the admin-only Captains view shows
  // it. It is a 5-digit convenience credential for entering youth scores, not
  // a password hash, and it is deliberately readable by the league office.
  const auths = await Promise.all(
    teams.map((d) =>
      db
        .doc(`leagues/${leagueId}/teams/${d.id}/_private/auth`)
        .get()
        .catch(() => null),
    ),
  );

  const captains = teams
    .map((d, i) => {
      const t = d.data();
      const c = contacts[i];
      const cdata = c && c.exists ? c.data() : null;
      let managers = Array.isArray(cdata?.managers)
        ? (cdata!.managers as unknown[]).map((m) => {
            const o = (m ?? {}) as Record<string, unknown>;
            return {
              name: String(o.name ?? ""),
              email: String(o.email ?? ""),
            };
          })
        : [];

      // Fall back to the address captured at registration. Teams registered
      // before contacts were written to _private/contact showed "no email on
      // file" even though the coach had typed one into the form, and teams
      // created by hand in admin never had a contact doc at all. The team doc
      // keeps registered_email, so use it rather than claiming we have
      // nothing. A real contact record always wins.
      if (managers.length === 0 && typeof t.registered_email === "string" && t.registered_email) {
        managers = [{ name: "", email: t.registered_email }];
      }
      return {
        teamId: d.id,
        teamName: String(t.name ?? d.id),
        managers,
        hasPassword: t.has_captain_password === true,
        code: String(auths[i]?.data()?.captain_password ?? ""),
        lastLogin: lastLogin[d.id] ?? "",
      };
    })
    .sort((a, b) => a.teamName.localeCompare(b.teamName));

  return NextResponse.json({ ok: true, captains });
}
