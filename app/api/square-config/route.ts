// GET /api/square-config — the two PUBLIC identifiers the embedded Square
// card form needs in the browser: the application id and the location id.
//
// Neither is a secret. The application id (sq0idp-…) is designed to ship to
// the client, and the location id is a public account identifier. The access
// token never leaves the server — it is used here only to look the location
// up, so nobody has to hand-copy it into another env var.
//
// Returns { configured: false } rather than an error when Square isn't set
// up, so the payment UI can quietly fall back to Venmo and check.

import { NextResponse } from "next/server";
import { resolveLocationId, squareEnv } from "@/lib/square";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const token = process.env.SQUARE_ACCESS_TOKEN;
  const appId = process.env.SQUARE_APP_ID;

  if (!token || !appId) {
    return NextResponse.json(
      { configured: false },
      { headers: { "cache-control": "no-store" } },
    );
  }

  const locationId = await resolveLocationId(token);
  if (!locationId) {
    return NextResponse.json(
      { configured: false },
      { headers: { "cache-control": "no-store" } },
    );
  }

  return NextResponse.json(
    { configured: true, appId, locationId, env: squareEnv() },
    { headers: { "cache-control": "no-store" } },
  );
}
