// POST /api/admin-free-agent — approve / reject a player registration
// for the free-agent pool (Adam, 2026-06).
//
// A player who registers (esp. picking "Free Agent") does NOT appear in
// the captains' Free Agents pool until an admin approves them here. The
// admin can instead reject them, or assign them straight onto a team
// (/api/admin-assign-registration). Sets `free_agent_status` on the
// player_registration submission:
//   - "approved" → shows in the pool (/api/free-agents)
//   - "rejected" → hidden
//   - "pending"  → default (missing field treated as pending)
//
// Auth: bearer token; caller must be admin of leagueId.
// Body: { leagueId, id, decision: "approve" | "reject" | "pending" }

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";

export async function POST(req: Request) {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });
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

  let body: { leagueId?: unknown; id?: unknown; decision?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { leagueId, id, decision } = body;
  if (typeof leagueId !== "string" || !leagueId) {
    return NextResponse.json({ error: "leagueId is required" }, { status: 400 });
  }
  if (typeof id !== "string" || !id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  if (decision !== "approve" && decision !== "reject" && decision !== "pending") {
    return NextResponse.json(
      { error: "decision must be approve | reject | pending" },
      { status: 400 },
    );
  }

  const callerLeagues = decoded.leagues as Record<string, string> | undefined;
  if (callerLeagues?.[leagueId] !== "admin") {
    return NextResponse.json(
      { error: `Not admin of league "${leagueId}"` },
      { status: 403 },
    );
  }

  const free_agent_status =
    decision === "approve"
      ? "approved"
      : decision === "reject"
        ? "rejected"
        : "pending";

  const db = getAdminDb();
  const ref = db.doc(
    `leagues/${leagueId}/form_submissions/player_registration/items/${id}`,
  );
  const snap = await ref.get();
  if (!snap.exists) {
    return NextResponse.json({ error: "Submission not found" }, { status: 404 });
  }
  await ref.set(
    {
      free_agent_status,
      free_agent_decided_at: new Date().toISOString(),
      free_agent_decided_by: decoded.uid,
    },
    { merge: true },
  );

  return NextResponse.json({ ok: true, free_agent_status });
}
