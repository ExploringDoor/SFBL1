// GET /api/team-pitch-counts?leagueId=&teamId= — returns a team's pitch
// outings, read server-side with the Admin SDK. The public client read of
// /pitch_outings depends on a firestore rule (allow read: if true) that isn't
// deployed to every environment yet; reading here keeps the coach portal's
// pitch list working regardless. Data is non-sensitive (it's the same info
// shown on the public /eligibility page).

import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const leagueId = (searchParams.get("leagueId") ?? "").trim();
  const teamId = (searchParams.get("teamId") ?? "").trim();
  if (!/^[a-z0-9_-]+$/i.test(leagueId) || !teamId) {
    return NextResponse.json({ error: "missing params" }, { status: 400 });
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
