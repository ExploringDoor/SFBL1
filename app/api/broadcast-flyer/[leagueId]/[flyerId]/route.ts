// GET /api/broadcast-flyer/{leagueId}/{flyerId} serves a flyer attached to a
// league broadcast as real image bytes.
//
// Modelled on /api/team-logo, for the same reason: a data: URL is fine in a
// database and useless in an inbox. Gmail drops them, so an inlined flyer is a
// blank rectangle in the one place it has to appear.
//
// leagueId is a path segment rather than the x-tenant-id header because
// middleware.ts deliberately does not run on /api/*, so there is no tenant
// header here. Do not "simplify" this to headers(), every flyer would 404.
//
// No auth: a flyer is sent to a mailing list, so it is public the moment it
// goes out, and an inbox cannot present a bearer token. The read is pinned to
// one field of one document under a fixed path, so it cannot be walked into
// anything else.

import { getAdminDb } from "@/lib/firebase-admin";
import { isAllowedFlyerDataUrl } from "@/lib/flyer";

export const runtime = "nodejs";

// Both ids are interpolated into a Firestore path below, so anything that could
// carry a slash or a .. is rejected before it gets near one.
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

export async function GET(
  _req: Request,
  { params }: { params: { leagueId: string; flyerId: string } },
) {
  const { leagueId, flyerId } = params;
  if (!SAFE_ID.test(leagueId) || !SAFE_ID.test(flyerId)) {
    return new Response("Bad request", { status: 400 });
  }

  let raw: unknown;
  try {
    const snap = await getAdminDb()
      .doc(`leagues/${leagueId}/broadcast_flyers/${flyerId}`)
      .get();
    raw = snap.data()?.data_url;
  } catch {
    // A flyer that fails to load is a missing image. It is never worth a 500,
    // which is what the site monitor reads as the site being down.
    return new Response("Not found", { status: 404 });
  }

  // Checked again here rather than trusted from the write path, because the
  // allowlist is what keeps svg+xml (which can carry script) from being served
  // off the league's own origin.
  const m = isAllowedFlyerDataUrl(raw)
    ? /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s.exec(raw)
    : null;
  if (!m) return new Response("Not found", { status: 404 });

  const bytes = new Uint8Array(Buffer.from(m[2]!, "base64"));

  // Cache-Control on the 200 branch ONLY. Pinning a 404 behind a long max-age
  // is a mistake this repo has made before. Immutable is safe because a flyer
  // document is written once and never overwritten: a new send gets a new id.
  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": m[1]!,
      "Cache-Control": "public, max-age=31536000, s-maxage=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
