// /api/auth-bridge/create — Safari → PWA auth handoff (step 1 of 2).
//
// Why this exists: on iOS, tapping a magic-link email always opens
// Safari, never the installed PWA. Safari and the PWA have
// ISOLATED Firebase Auth storage (separate indexedDBs), so even a
// successful sign-in in Safari leaves the PWA logged out. This
// endpoint solves it by minting a one-time custom token after the
// Safari sign-in, parked in Firestore under a bridgeId the PWA
// generated before it requested the magic link. The PWA polls
// /api/auth-bridge/claim with that bridgeId to pick the token up
// and call signInWithCustomToken locally.
//
// Security model:
//   • The caller of this endpoint is the user who just completed
//     magic-link sign-in in Safari. We require their fresh ID
//     token in the Authorization header.
//   • The bridgeId is a UUID generated client-side. Unguessable
//     (122 bits of entropy). Anyone who has it can claim the
//     token; nobody else can.
//   • The bridge doc has a 5-minute hard TTL and is one-time-use
//     (the claim endpoint deletes it on read).
//
// Body: { bridgeId: string }  — UUID v4 the PWA generated
// Auth:  Authorization: Bearer <fresh ID token of the signed-in user>

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";

const BRIDGE_TTL_MS = 5 * 60 * 1000;
const UUID_RE = /^[0-9a-f-]{36}$/i;

export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json(
      { error: "Missing bearer token" },
      { status: 401 },
    );
  }
  const idToken = authHeader.slice("Bearer ".length).trim();

  let decoded;
  try {
    decoded = await getAdminAuth().verifyIdToken(idToken);
  } catch {
    return NextResponse.json(
      { error: "Invalid or expired token" },
      { status: 401 },
    );
  }

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

  // Mint a custom token for the same uid. signInWithCustomToken
  // gives the PWA a full session identical to a magic-link sign-in,
  // including any custom claims (leagues / role) we've already
  // attached to the user.
  const customToken = await getAdminAuth().createCustomToken(decoded.uid);

  const now = Date.now();
  await getAdminDb()
    .doc(`auth_bridges/${bridgeId}`)
    .set({
      token: customToken,
      uid: decoded.uid,
      created_at: now,
      expires_at: now + BRIDGE_TTL_MS,
    });

  return NextResponse.json({ ok: true }, { status: 200 });
}
