// /api/public-admin-claim — mints a Firebase custom token that gives
// the caller a `leagues: { <leagueId>: "admin" }` claim if the
// submitted password matches the league's configured admin password.
//
// Only works for leagues with `admin.passwordless: true` set on the
// LeagueConfig doc. The password lives at
// /leagues/<leagueId>.admin.password and is never forwarded to the
// client via toPublicConfig — only the boolean reaches the public
// layout, so a curious browser DevTools poke can't lift the
// password off the response payload.
//
// Body: { leagueId, password }
// Response: { ok: true, customToken } — client calls
// signInWithCustomToken(customToken) and proceeds to /admin.
//
// Same anti-abuse posture as /api/public-captain-claim: per-IP rate
// limit + every successful sign-in writes an audit log entry.

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";

// Tight rate limit on admin: 20 attempts per IP per 10 min. Slows
// brute-force scanning to a crawl. Admin's a single shared password
// per league so this only ever needs to be hit a handful of times
// per legitimate sign-in.
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const ipBuckets = new Map<string, { count: number; resets_at: number }>();

function rateLimit(ip: string): boolean {
  const now = Date.now();
  const cur = ipBuckets.get(ip);
  if (!cur || cur.resets_at < now) {
    ipBuckets.set(ip, { count: 1, resets_at: now + RATE_WINDOW_MS });
    return true;
  }
  cur.count += 1;
  return cur.count <= RATE_LIMIT;
}

// Constant-time password compare so a brute-force attacker can't
// learn password length / prefix-correctness from response timing.
//
// Audit M10: the previous implementation padded/truncated both
// strings to 256 chars before comparing. Two inputs longer than 256
// that shared a 256-char prefix would falsely compare equal (the
// length check after only catches *differing* lengths, not a shared
// truncated prefix at equal length). Hashing both to fixed 32-byte
// SHA-256 digests removes the cap entirely: digests are always the
// same length (so timingSafeEqual is happy), the FULL content is
// covered (no truncation), and the comparison is still constant-time.
async function safeEqual(a: string, b: string): Promise<boolean> {
  const { createHash, timingSafeEqual } = await import("node:crypto");
  const digest = (s: string) =>
    createHash("sha256").update(s, "utf8").digest();
  return timingSafeEqual(digest(a), digest(b));
}

export async function POST(req: Request) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  if (!rateLimit(ip)) {
    return NextResponse.json(
      { error: "Too many attempts; try again later." },
      { status: 429 },
    );
  }

  let body: { leagueId?: unknown; password?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const leagueId = body.leagueId;
  const password = body.password;
  if (typeof leagueId !== "string" || !/^[a-z][a-z0-9-]+$/i.test(leagueId)) {
    return NextResponse.json(
      { error: "leagueId required" },
      { status: 400 },
    );
  }
  if (typeof password !== "string" || !password) {
    return NextResponse.json(
      { error: "password required" },
      { status: 400 },
    );
  }

  const db = getAdminDb();
  const leagueSnap = await db.doc(`leagues/${leagueId}`).get();
  if (!leagueSnap.exists) {
    return NextResponse.json(
      { error: `League "${leagueId}" not found` },
      { status: 404 },
    );
  }
  const data = leagueSnap.data() ?? {};
  const adminCfg = data.admin ?? {};
  if (adminCfg.passwordless !== true || typeof adminCfg.password !== "string") {
    return NextResponse.json(
      { error: "Password admin sign-in is not enabled for this league." },
      { status: 403 },
    );
  }

  if (!(await safeEqual(password, String(adminCfg.password)))) {
    return NextResponse.json(
      { error: "Wrong password." },
      { status: 401 },
    );
  }

  // Mint the admin token. Synthetic uid shared across all visitors
  // who type the right password — Firebase doesn't mind re-issued
  // tokens for the same uid.
  const uid = `public-admin:${leagueId}`;
  const claims = {
    leagues: { [leagueId]: "admin" },
    public_admin: true,
    league: leagueId,
  };
  const customToken = await getAdminAuth().createCustomToken(uid, claims);

  // Audit every successful admin sign-in so "who edited this team
  // / approved this signup / published this banner" stays
  // traceable even when there's no real user identity.
  try {
    await db.collection(`leagues/${leagueId}/audit`).add({
      kind: "public_admin_claim",
      ip,
      at: new Date().toISOString(),
    });
  } catch {
    /* don't fail the request on audit hiccup */
  }

  return NextResponse.json({ ok: true, customToken });
}
