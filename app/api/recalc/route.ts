// POST /api/recalc — admin-only league stat recalc.
//
// Verifies a Firebase ID token via Admin SDK, checks the caller is
// admin of the requested league, then runs recalcLeague (which writes
// stats via Admin SDK, bypassing client rules by design).

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";
import { recalcLeague } from "@/lib/stats";

// API routes are server-only. Force Node runtime — firebase-admin won't
// run on Edge.
export const runtime = "nodejs";

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
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }

  let body: { leagueId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const leagueId = body.leagueId;
  if (typeof leagueId !== "string" || !leagueId) {
    return NextResponse.json(
      { error: "Body must include { leagueId: string }" },
      { status: 400 },
    );
  }

  const leagues = decoded.leagues as Record<string, string> | undefined;
  if (leagues?.[leagueId] !== "admin") {
    return NextResponse.json(
      { error: `Not admin of league "${leagueId}"` },
      { status: 403 },
    );
  }

  try {
    const result = await recalcLeague(getAdminDb(), leagueId);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[api/recalc] failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Recalc failed" },
      { status: 500 },
    );
  }
}
