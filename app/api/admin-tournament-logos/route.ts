// GET /api/admin-tournament-logos?leagueId=… — the overrides currently in
// force, so the admin panel shows exactly what the public pages show.
//
// Admin-only. The logos themselves are not secret (they are on the public
// site), but this returns every one of them in a single response, which is a
// few hundred KB of base64 and not something to serve to anonymous callers.

import { NextResponse } from "next/server";
import { getAdminAuth } from "@/lib/firebase-admin";
import { loadTournamentLogos } from "@/lib/tournament-logos";

export const runtime = "nodejs";

export async function GET(req: Request) {
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

  const leagueId = new URL(req.url).searchParams.get("leagueId") ?? "";
  if (!/^[a-z0-9_-]+$/.test(leagueId)) {
    return NextResponse.json({ error: "leagueId required" }, { status: 400 });
  }

  const leagues = decoded.leagues as Record<string, string> | undefined;
  if (leagues?.[leagueId] !== "admin") {
    return NextResponse.json(
      { error: `Not admin of league "${leagueId}"` },
      { status: 403 },
    );
  }

  return NextResponse.json({ logos: await loadTournamentLogos(leagueId) });
}
