// GET /api/team-logo/{leagueId}/{teamId}/{v} serves a coach uploaded team logo
// as real image bytes instead of inlining it into a page.
//
// See lib/team-logo.ts for why this exists. Short version: eight data: URLs
// were adding 1.43MB to the Island home page and to /history, and would have
// landed in the ticker on every page of the site once real games started on
// 2026-09-12.
//
// {v} is a fingerprint of the logo and this route ignores it. It is in the path
// only so re-uploaded art gets a new URL, which is what makes it safe to answer
// immutable. A stale {v} still serves the current logo, which is the behaviour
// we want.
//
// leagueId is a path segment rather than the x-tenant-id header because
// middleware.ts deliberately does not run on /api/*, so there is no tenant
// header here. Do not "simplify" this to headers(), every logo would 404.
//
// Team logos are public art on a public site, so there is no auth. The read is
// pinned to one field of one doc under leagues/{leagueId}/teams/{teamId}, so it
// cannot be walked into anything else, and it exposes strictly less than the
// public pages already do.

import { getAdminDb } from "@/lib/firebase-admin";
import { isAllowedLogoDataUrl } from "@/lib/team-logo";

export const runtime = "nodejs";

// Both ids are interpolated into a Firestore path below, so anything that could
// carry a slash or a .. is rejected before it gets near one.
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

export async function GET(
  _req: Request,
  { params }: { params: { leagueId: string; teamId: string; v: string } },
) {
  const { leagueId, teamId } = params;
  if (!SAFE_ID.test(leagueId) || !SAFE_ID.test(teamId)) {
    return new Response("Bad request", { status: 400 });
  }

  let raw: unknown;
  try {
    const snap = await getAdminDb()
      .doc(`leagues/${leagueId}/teams/${teamId}`)
      .get();
    raw = snap.data()?.logo_url;
  } catch {
    // A logo that fails to load is a missing image. It is never worth a 500,
    // which is what the site monitor reads as the site being down.
    return new Response("Not found", { status: 404 });
  }

  // The subtype is NOT free-form. `image/[a-zA-Z0-9.+-]+` matches svg+xml,
  // which would mean serving coach-uploaded script from the league's own
  // origin. Allowlist, checked again here rather than trusted from the write
  // path, because anything already in the database predates that check.
  const m =
    typeof raw === "string" && isAllowedLogoDataUrl(raw)
      ? /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s.exec(raw)
      : null;
  // Path logos never reach this route, teamLogoSrc passes them through
  // untouched, so anything that is not a data: image here is genuinely absent.
  if (!m) return new Response("Not found", { status: 404 });

  const bytes = new Uint8Array(Buffer.from(m[2]!, "base64"));

  // Cache-Control is set on the 200 branch ONLY. Pinning a 404 behind a long
  // max-age is a mistake this repo has made before. vercel.json's header rules
  // match /:tenant/... paths, not /api/*, so nothing adds one back for us.
  // s-maxage is spelled out so the Vercel edge caches this, not just browsers.
  // Content-Length is left to the platform on purpose, a hand set value that
  // disagrees with the transfer encoding fails the request outright.
  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": m[1]!,
      "Cache-Control": "public, max-age=31536000, s-maxage=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      // Belt and braces behind the allowlist. `inline` keeps it an image
      // rather than a download, and the sandbox CSP means that even if a type
      // we did not anticipate slips through one day, the response cannot run
      // script or reach back to the origin it was served from.
      "Content-Disposition": "inline",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
