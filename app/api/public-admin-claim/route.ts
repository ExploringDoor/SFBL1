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
import { ADMIN_ROLES } from "@/lib/admin-roles";
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
  let passwordless = adminCfg.passwordless === true;
  let storedPassword: string | null =
    typeof adminCfg.password === "string" ? adminCfg.password : null;

  // Env-var fallback for hardcoded-config tenants (e.g. SFBL): the
  // tenant declares `admin.passwordless: true` in lib/tenants.ts and
  // the actual password lives in a Vercel env var
  // (e.g. SFBL_ADMIN_PASSWORD). This keeps the password OUT of git
  // history and out of Firestore — and avoids needing an out-of-band
  // script run for tenants that don't have an admin-editable doc.
  // LBDC stays on the Firestore path (set above); the env-var check
  // only fires when Firestore doesn't already carry the password.
  if (!storedPassword) {
    const envKey =
      leagueId.toUpperCase().replace(/[^A-Z0-9]/g, "_") + "_ADMIN_PASSWORD";
    const envPw = process.env[envKey];
    if (envPw && envPw.trim()) {
      storedPassword = envPw;
      // Treat a configured env var as opting this tenant into the
      // passwordless gate even if the Firestore flag wasn't flipped.
      passwordless = true;
    }
  }

  if (!passwordless || !storedPassword) {
    return NextResponse.json(
      { error: "Password admin sign-in is not enabled for this league." },
      { status: 403 },
    );
  }

  // SCOPED ROLES. A league can hand out extra passwords that open only part of
  // the admin, configured at leagues/{id}.admin.roles:
  //
  //   admin: { roles: { umpires: { password: "..." }, scheduler: { ... } } }
  //
  // Island 2026-09-01: Mike wanted his umpire in chief to "see umpire stuff"
  // and his assistant to run schedules, scores and coach messages, without
  // either of them getting the Payments tab, every coach's sign-in code, or
  // the clinic families' details.
  //
  // THE FULL PASSWORD IS TRIED FIRST and wins on a tie, so no role password
  // can ever shadow the owner's. Every candidate is compared with the same
  // constant-time check, and a wrong password still costs the same work
  // whichever slot it was closest to.
  //
  // What each role opens lives in lib/admin-roles.ts, not here. This route
  // only decides WHICH role the caller proved they hold.
  const roleCfg = (adminCfg.roles ?? {}) as Record<
    string,
    { password?: unknown } | undefined
  >;
  let matchedRole: string | null = null;
  let matched = await safeEqual(password, storedPassword);
  if (!matched) {
    for (const [roleId, cfg] of Object.entries(roleCfg)) {
      const pw = cfg?.password;
      if (typeof pw !== "string" || !pw) continue;
      if (!ADMIN_ROLES[roleId]) continue; // configured but unknown to the code
      if (await safeEqual(password, pw)) {
        matched = true;
        matchedRole = roleId;
        break;
      }
    }
  }
  if (!matched) {
    return NextResponse.json(
      { error: "Wrong password." },
      { status: 401 },
    );
  }

  // Mint the admin token. Synthetic uid shared across all visitors
  // who type the right password — Firebase doesn't mind re-issued
  // tokens for the same uid.
  //
  // The uid carries the role so the audit log and Firestore can tell a scoped
  // session apart from the owner's, and so one role signing out cannot drop
  // another's token.
  const uid = matchedRole
    ? `public-admin:${leagueId}:${matchedRole}`
    : `public-admin:${leagueId}`;
  const claims = {
    leagues: { [leagueId]: matchedRole ? `admin:${matchedRole}` : "admin" },
    public_admin: true,
    league: leagueId,
    // BOTH the role id and its expanded scopes go in the token, and they are
    // read by different layers.
    //
    // API routes read the role id and expand it through ADMIN_ROLES, so the
    // scope table lives in one place in TypeScript. Firestore rules cannot do
    // that lookup: rules have no access to the table, so a rule asking "may
    // this caller read box scores" would otherwise have to know that the
    // "scheduler" role happens to include "scores". That coupling is exactly
    // how a role gains a permission nobody intended.
    //
    // So the scopes are expanded HERE, once, at the only place that decides
    // which role a caller holds, and rules match on the list.
    ...(matchedRole
      ? {
          admin_role: matchedRole,
          admin_scopes: [...(ADMIN_ROLES[matchedRole]?.scopes ?? [])],
        }
      : {}),
  };
  const customToken = await getAdminAuth().createCustomToken(uid, claims);

  // Audit every successful admin sign-in so "who edited this team
  // / approved this signup / published this banner" stays
  // traceable even when there's no real user identity.
  try {
    await db.collection(`leagues/${leagueId}/audit`).add({
      kind: "public_admin_claim",
      // Which door they came through. Without this the audit log cannot tell
      // the owner apart from a scoped assistant.
      role: matchedRole ?? "admin",
      ip,
      at: new Date().toISOString(),
    });
  } catch {
    /* don't fail the request on audit hiccup */
  }

  return NextResponse.json({ ok: true, customToken });
}
