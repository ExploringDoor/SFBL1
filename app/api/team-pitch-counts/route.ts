// GET /api/team-pitch-counts?leagueId=&teamId= — a team's pitch outings,
// read server-side with the Admin SDK. Used by the captain portal's Pitch
// Counts tab.
//
// AUTH: these outings carry minors' full names (COYBL is 7U-14U, Island
// 8U-18U), so this endpoint is NOT public. It requires a Firebase ID token
// for an admin of the league OR the captain of THIS team — the same gate as
// /api/team-roster. (This route was previously unauthenticated, which let
// anyone enumerate a youth team's roster of pitcher names; audit fix.)

import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const leagueId = (searchParams.get("leagueId") ?? "").trim();
  const teamId = (searchParams.get("teamId") ?? "").trim();
  if (!/^[a-z0-9_-]+$/i.test(leagueId) || !teamId) {
    return NextResponse.json({ error: "missing params" }, { status: 400 });
  }

  // Admin of the league, or captain of this specific team, only.
  const authHdr = req.headers.get("authorization");
  if (!authHdr?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });
  }
  const idToken = authHdr.slice("Bearer ".length).trim();
  let decoded;
  try {
    decoded = await getAdminAuth().verifyIdToken(idToken);
  } catch {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }
  const claim = (decoded.leagues as Record<string, string> | undefined)?.[
    leagueId
  ];
  if (claim !== "admin" && claim !== `captain:${teamId}`) {
    return NextResponse.json(
      { error: "Not admin or captain of this team" },
      { status: 403 },
    );
  }

  try {
    const db = getAdminDb();
    const snap = await db
      .collection(`leagues/${leagueId}/pitch_outings`)
      .where("team_id", "==", teamId)
      .get();
    const outings = snap.docs.map((d) => {
      const x = d.data();
      return {
        id: d.id,
        player_name: String(x.player_name ?? ""),
        date: String(x.date ?? ""),
        pitches: Number(x.pitches ?? 0),
      };
    });
    return NextResponse.json({ ok: true, outings });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "read failed" },
      { status: 500 },
    );
  }
}
