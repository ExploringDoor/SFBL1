// /api/public-captain-claim — mints a Firebase custom token that
// gives the caller a `captain:<team_id>` claim for the requested
// league. Only works for leagues with `captain.passwordless: true`
// set on the tenant doc. The caller picks the team_id from the
// captain landing page; we do NOT verify identity. This is the
// "anyone with the URL can manage their team" mode Adam asked for
// on LBDC where every captain is known to the commissioner and
// magic-link friction was killing adoption.
//
// Body: { leagueId, teamId }
// Response: { ok: true, customToken } — client calls
// signInWithCustomToken(customToken) and proceeds.
//
// Anti-abuse:
//   1. We require `captain.passwordless: true` on the LeagueConfig.
//      Without it the endpoint always returns 403.
//   2. The teamId must exist in /leagues/<id>/teams.
//   3. Per-IP rate limit (in-process Map) caps abusive callers.
//
// Tokens are minted with a synthetic uid `public-captain:<league>:
// <team>` so multiple visitors who pick the same team share one
// Firebase Auth identity — keeps the user pool small and avoids
// orphaning anonymous users.

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";

// 60 req/IP/10min — generous since LBDC captains can re-claim
// freely; this exists to keep a runaway script from minting infinite
// tokens, not to police real users.
const RATE_LIMIT = 60;
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

export async function POST(req: Request) {
  // Caller IP for the rate limiter. Trust the first hop in
  // x-forwarded-for when behind Vercel; otherwise fall back.
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  if (!rateLimit(ip)) {
    return NextResponse.json(
      { error: "Too many requests; try again later." },
      { status: 429 },
    );
  }

  let body: {
    leagueId?: unknown;
    teamId?: unknown;
    teamPassword?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const leagueId = body.leagueId;
  if (typeof leagueId !== "string" || !/^[a-z][a-z0-9-]+$/i.test(leagueId)) {
    return NextResponse.json(
      { error: "leagueId required" },
      { status: 400 },
    );
  }

  // Two input modes:
  //   - teamId: explicit team slug (admin tooling, deep links)
  //   - teamPassword: free-text "password" — resolved to a team by
  //     matching against the team_id slug OR the team name, both
  //     normalized to alphanumerics-lowercased. So a captain can
  //     type "Brooklyn", "brooklyn", "BROOKLYN", or "black sox" /
  //     "BlackSox" / "black-sox" interchangeably.
  const explicitTeamId =
    typeof body.teamId === "string" && /^[a-z0-9_-]+$/i.test(body.teamId)
      ? body.teamId
      : null;
  const rawPassword =
    typeof body.teamPassword === "string" ? body.teamPassword.trim() : "";
  if (!explicitTeamId && !rawPassword) {
    return NextResponse.json(
      { error: "Provide teamId or teamPassword" },
      { status: 400 },
    );
  }

  // Gate: this endpoint only works for leagues that have opted into
  // passwordless captain mode. Any league without that flag falls
  // back to the standard magic-link flow.
  const db = getAdminDb();
  const leagueSnap = await db.doc(`leagues/${leagueId}`).get();
  if (!leagueSnap.exists) {
    return NextResponse.json(
      { error: `League "${leagueId}" not found` },
      { status: 404 },
    );
  }
  const data = leagueSnap.data() ?? {};
  if (data.captain?.passwordless !== true) {
    return NextResponse.json(
      { error: "Passwordless captain access is not enabled for this league." },
      { status: 403 },
    );
  }

  // Resolve the team_id. If the caller passed teamId we look it up
  // directly; otherwise we scan the league's teams and find one whose
  // id or name normalizes to the same value as the password.
  let teamId: string | null = null;
  if (explicitTeamId) {
    const teamSnap = await db
      .doc(`leagues/${leagueId}/teams/${explicitTeamId}`)
      .get();
    if (teamSnap.exists) teamId = explicitTeamId;
  } else {
    const target = normalize(rawPassword);
    const teamsSnap = await db
      .collection(`leagues/${leagueId}/teams`)
      .get();
    for (const d of teamsSnap.docs) {
      const td = d.data();
      const id = d.id;
      const name = String(td.name ?? "");
      const abbrev = String(td.abbrev ?? "");
      // Admin-set custom password wins if present — gives Adam a way
      // to assign weird per-team passwords later without renaming.
      const custom = String(td.captain_password ?? "");
      // Also accept the first word of the team name so the boomers
      // teams (Eddie Murray Mashers '56) don't require typing 22
      // chars. Means captain of "Eddie Murray Mashers '56" can sign
      // in with "eddie" / "Eddie" / etc.
      const firstWord = name.split(/\s+/)[0] ?? "";
      const candidates = [custom, id, name, abbrev, firstWord].filter(
        Boolean,
      );
      if (candidates.some((c) => normalize(c) === target)) {
        teamId = id;
        break;
      }
    }
  }
  if (!teamId) {
    return NextResponse.json(
      { error: "Wrong password. The password is your team's name." },
      { status: 401 },
    );
  }

  // Mint a custom token with the captain claim. The synthetic uid is
  // shared across all visitors who pick the same team — Firebase
  // doesn't mind a re-issued token. We tag the user as
  // public_captain so audit logs can distinguish these submissions
  // from magic-link captains if we ever want to.
  const uid = `public-captain:${leagueId}:${teamId}`;
  const claims = {
    leagues: { [leagueId]: `captain:${teamId}` },
    public_captain: true,
    league: leagueId,
    team: teamId,
  };
  const customToken = await getAdminAuth().createCustomToken(uid, claims);

  // Best-effort audit. Useful when investigating "who edited this
  // box score" later — captures the rotating team picks per visitor.
  try {
    await db.collection(`leagues/${leagueId}/audit`).add({
      kind: "public_captain_claim",
      team_id: teamId,
      ip,
      at: new Date().toISOString(),
    });
  } catch {
    /* don't fail the request if audit write hiccups */
  }

  return NextResponse.json({ ok: true, customToken });
}

// Strip everything but [a-z0-9] and lowercase — used to compare a
// captain's typed "password" against the team's id or display name
// without worrying about spaces / hyphens / apostrophes / case.
//   "Brooklyn"           -> "brooklyn"
//   "Black Sox"          -> "blacksox"
//   "black-sox"          -> "blacksox"
//   "Eddie Murray Mashers '56" -> "eddiemurraymashers56"
function normalize(s: string): string {
  return String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
}
