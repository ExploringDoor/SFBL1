// GET /api/team-logo?league=<id>&team=<id>&v=<stamp> — serves a team logo.
//
// Team logos uploaded via the captain portal are stored as base64 in
// leagues/{leagueId}/team_logos/{teamId} (Admin-SDK-only). This route reads
// that doc with the Admin SDK and returns the raw PNG bytes. Public — team
// logos are public — and aggressively cached: the `v` cache-buster on the
// URL changes whenever a captain uploads a new one, so `immutable` is safe
// and the Firestore read happens only on a cold cache.

import { getAdminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const league = url.searchParams.get("league");
  const team = url.searchParams.get("team");
  if (!league || !team) {
    return new Response("Missing league or team", { status: 400 });
  }

  let data: FirebaseFirestore.DocumentData | undefined;
  try {
    const snap = await getAdminDb()
      .doc(`leagues/${league}/team_logos/${team}`)
      .get();
    if (!snap.exists) return new Response("Not found", { status: 404 });
    data = snap.data();
  } catch {
    return new Response("Error", { status: 500 });
  }

  const b64 = data?.png_base64;
  if (typeof b64 !== "string" || !b64) {
    return new Response("Not found", { status: 404 });
  }
  const bytes = Buffer.from(b64, "base64");

  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type":
        typeof data?.content_type === "string" ? data.content_type : "image/png",
      "Content-Length": String(bytes.length),
      // Safe to cache forever: the URL carries a `v` that changes on upload.
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
