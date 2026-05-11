// /api/auth-bridge/claim — Safari → PWA auth handoff (step 2 of 2).
//
// Called by the PWA after it sent a magic-link request. It polls
// this endpoint with the bridgeId it generated; when the user
// completes sign-in in Safari, the create endpoint parks a custom
// token under that bridgeId, and the next claim call here returns
// the token and atomically deletes the doc (one-time use).
//
// This endpoint is PUBLIC by design — the PWA isn't authenticated
// yet, so we can't require an Authorization header. Security
// relies on bridgeId being an unguessable UUID + TTL + delete-on-
// read. The doc is gone after first successful claim.
//
// Body: { bridgeId: string }
// Returns:
//   200 { token }    — bridge claimed; PWA should signInWithCustomToken
//   404 (no body)    — bridge not yet present or expired

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f-]{36}$/i;

export async function POST(req: Request) {
  let body: { bridgeId?: unknown };
  try {
    body = (await req.json()) as { bridgeId?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const bridgeId = typeof body.bridgeId === "string" ? body.bridgeId : "";
  if (!UUID_RE.test(bridgeId)) {
    return NextResponse.json(
      { error: "bridgeId must be a UUID" },
      { status: 400 },
    );
  }

  const ref = getAdminDb().doc(`auth_bridges/${bridgeId}`);
  const snap = await ref.get();
  if (!snap.exists) {
    return new NextResponse(null, { status: 404 });
  }
  const data = snap.data() as
    | { token?: string; expires_at?: number }
    | undefined;
  const expiresAt = Number(data?.expires_at ?? 0);
  const token = typeof data?.token === "string" ? data.token : "";
  // Always delete on read — bridge is one-time use even when
  // expired (so the doc can't accumulate). Run this BEFORE the
  // expiry check so a stale doc gets cleaned up too.
  await ref.delete();
  if (!token || Date.now() > expiresAt) {
    return new NextResponse(null, { status: 404 });
  }
  return NextResponse.json({ token }, { status: 200 });
}
