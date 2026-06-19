// GET /api/registrations?leagueId=<slug> — admin-only list of team
// registrations for a league. Registrations hold coach PII, so this is
// gated exactly like the other admin endpoints: verify the caller's ID
// token, require leagues[leagueId] === 'admin', then read via the Admin
// SDK. Never exposed to the public.

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";

export async function GET(req: Request) {
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

  const url = new URL(req.url);
  const leagueId =
    url.searchParams.get("leagueId") ?? req.headers.get("x-tenant-id") ?? "";
  if (!leagueId || !/^[a-z0-9_-]+$/.test(leagueId)) {
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
  const snap = await db
    .collection(`leagues/${leagueId}/registrations`)
    .orderBy("submitted_at", "desc")
    .get();
  const registrations = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  return NextResponse.json({ ok: true, count: registrations.length, registrations });
}
