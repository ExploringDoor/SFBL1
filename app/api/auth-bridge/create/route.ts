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

  // Audit H4 (2026-05-09): block bridge-doc overwrite to prevent
  // session fixation. Without this, Alice (with any valid token of
  // her own) could call /create with Bob's bridgeId — taken from
  // his magic-link URL — and overwrite the parked token. Bob's PWA
  // polls /claim, gets a custom token for ALICE's uid, and signs
  // in as her, unwittingly operating the captain/admin UI as her
  // account. Run as a transaction: if a doc already exists for
  // this bridgeId AND was created for a different uid, reject.
  const now = Date.now();
  const bridgeRef = getAdminDb().doc(`auth_bridges/${bridgeId}`);
  try {
    await getAdminDb().runTransaction(async (tx) => {
      const snap = await tx.get(bridgeRef);
      if (snap.exists) {
        const existing = snap.data() as { uid?: string } | undefined;
        if (existing?.uid && existing.uid !== decoded.uid) {
          throw new BridgeConflictError();
        }
        // Same uid claiming the same bridgeId again — idempotent
        // refresh (e.g. user retried the magic link). Fine to
        // re-set with a fresh token + extended TTL.
      }
      tx.set(bridgeRef, {
        token: customToken,
        uid: decoded.uid,
        created_at: now,
        expires_at: now + BRIDGE_TTL_MS,
      });
    });
  } catch (e) {
    if (e instanceof BridgeConflictError) {
      return NextResponse.json(
        { error: "bridgeId already claimed by another user" },
        { status: 409 },
      );
    }
    throw e;
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}

class BridgeConflictError extends Error {
  constructor() {
    super("bridge conflict");
    this.name = "BridgeConflictError";
  }
}
