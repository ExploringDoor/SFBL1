// POST /api/free-agents — the free-agent pool: players who registered
// but aren't on any team's roster yet, with their contact info, so a
// manager who's short players can reach out (Nelson, 2026-05-18).
//
// Source: player_registration form submissions that have NOT been
// assigned to a team (no assigned_player_id from
// /api/admin-assign-registration) and aren't deleted.
//
// Contact info (phone/email) is PII, so this is gated: caller must be
// a captain OR admin of the league. The submissions collection is
// admin-only at the rules layer, so this Admin-SDK endpoint is the
// only way a captain can see the pool.
//
// Body: { leagueId }
// Response: { ok, players: [{ id, name, position, division,
//             team_pref, email, phone, registered_at }] }

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

  // Gate: admin OR captain of this league (captains recruit; both see
  // contact info).
  const claim = (decoded.leagues as Record<string, string> | undefined)?.[
    leagueId
  ];
  const allowed =
    claim === "admin" ||
    (typeof claim === "string" && claim.startsWith("captain:"));
  if (!allowed) {
    return NextResponse.json(
      { error: "Captains/admins only" },
      { status: 403 },
    );
  }

  const db = getAdminDb();
  const snap = await db
    .collection(
      `leagues/${leagueId}/form_submissions/player_registration/items`,
    )
    .get();

  const players = snap.docs
    .map((d) => {
      const x = d.data();
      return {
        id: d.id,
        assigned: typeof x.assigned_player_id === "string" && !!x.assigned_player_id,
        deleted: x.deleted === true,
        // Admin must approve a registration before it shows in the pool
        // (Adam, 2026-06). Missing field = pending = hidden.
        fa: String(x.free_agent_status ?? "pending"),
        name: `${String(x.first_name ?? "").trim()} ${String(
          x.last_name ?? "",
        ).trim()}`.trim(),
        position: String(x.primary_position ?? ""),
        division: String(x.division ?? ""),
        team_pref: String(x.team_name ?? ""),
        email: String(x.email ?? ""),
        phone: String(x.phone ?? ""),
        registered_at: String(x.submitted_at ?? ""),
      };
    })
    // Free agents = registered, admin-approved, not assigned to a
    // roster, not deleted.
    .filter((p) => p.fa === "approved" && !p.assigned && !p.deleted && p.name)
    .sort((a, b) => b.registered_at.localeCompare(a.registered_at))
    .map(({ assigned, deleted, fa, ...p }) => {
      void assigned;
      void deleted;
      void fa;
      return p;
    });

  return NextResponse.json({ ok: true, players });
}
