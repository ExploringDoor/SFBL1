// /api/errors-log — best-effort write of client-side errors into
// /errors collection. Per CLAUDE.md: "log errors to /errors
// Firestore collection, view in platform admin dashboard." Replaces
// having to wire up Sentry for the v1 launch.
//
// Public-write — anyone can POST. We don't trust the body (could be
// adversarial) and we cap individual fields + the rate at the
// Firestore level. The platform admin dashboard at /_platform/errors
// renders these for triage.
//
// Body shape (all fields optional except `message`):
//   { message, digest?, stack?, url?, ua? }

import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getAdminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";

// Cap per field to keep the doc size manageable AND to avoid
// adversarial payloads dumping megabytes into our Firestore.
const MAX_FIELD = 4_000;

// Audit B3 (2026-05-09): per-IP rate limit. Without this, anyone on
// the internet can POST in a loop, balloon Firestore writes, and
// render /_platform/errors unusable. Numbers mirror /api/league-form:
// real client-side error reports are rare, so 10 / 10 min comfortably
// covers a misbehaving page without letting a bot DoS the collection.
// In-memory store is fine for the single-instance Vercel deploy; if
// we scale to multiple regions later, swap to a shared store.
const rate = new Map<string, { count: number; reset: number }>();
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT = 10;

function trim(s: unknown): string {
  if (typeof s !== "string") return "";
  return s.length > MAX_FIELD ? s.slice(0, MAX_FIELD) + "…[trimmed]" : s;
}

export async function POST(req: Request) {
  // Per-IP rate limit BEFORE any body parsing so a flood of empty
  // POSTs still costs us nothing beyond a Map lookup.
  const h = headers();
  const ip =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const now = Date.now();
  const entry = rate.get(ip);
  if (entry && now < entry.reset) {
    if (entry.count >= RATE_LIMIT) {
      return NextResponse.json(
        { ok: false, error: "Too many reports" },
        { status: 429 },
      );
    }
    entry.count++;
  } else {
    rate.set(ip, { count: 1, reset: now + RATE_WINDOW_MS });
  }

  let body: {
    message?: unknown;
    digest?: unknown;
    stack?: unknown;
    url?: unknown;
    ua?: unknown;
  } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" });
  }

  const message = trim(body.message);
  if (!message) {
    return NextResponse.json({ ok: false, error: "message required" });
  }

  // Best effort. If the write fails (rules misconfigured, Firestore
  // quota, etc.) we don't want to error-loop the client.
  try {
    const db = getAdminDb();
    await db.collection("errors").add({
      message,
      digest: trim(body.digest) || null,
      stack: trim(body.stack) || null,
      url: trim(body.url) || null,
      ua: trim(body.ua) || null,
      // Tenant context is not provided by the client (would require
      // re-resolving from Host); platform admin can correlate via URL.
      logged_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error("[errors-log] write failed:", e);
  }
  return NextResponse.json({ ok: true });
}
