// POST /api/admin-grant-claim — admin grants/revokes a role claim on
// another user. Eliminates the "ssh in and run a script per captain"
// bottleneck during onboarding.
//
// Body shape:
//   {
//     leagueId: string,
//     email: string,                          // target user's email
//     role: 'admin' | 'captain' | 'player' | 'remove',
//     teamId?: string,                        // required when role === 'captain'
//     playerId?: string,                      // required when role === 'player'
//   }
//
// Authority: caller must have `admin` claim on `leagueId`.
//
// What it does:
//   1. Look up target user by email (auth.getUserByEmail). 404 if no
//      such Firebase Auth user exists — captain has to magic-link
//      sign in once before we can grant them a claim. This is a real
//      ordering constraint and worth surfacing clearly.
//   2. Read target's existing customClaims. Read leagues map.
//   3. Mutate leagues[leagueId] for this league only — don't touch
//      other leagues' claims (a user might be admin of league A and
//      captain of league B; an admin of A revoking should only clear
//      A's entry).
//   4. Write back via setCustomUserClaims.
//
// Note: claims propagate on next ID token refresh (~1 hour cache,
// or immediately if the user calls getIdToken(true)). The captain
// page already does the force-refresh on mount via useLeagueRole, so
// captains see their new claim within seconds of signing in again.

import { NextResponse } from "next/server";
import { getAdminAuth } from "@/lib/firebase-admin";

export const runtime = "nodejs";

const ALLOWED_ROLES = new Set(["admin", "captain", "player", "remove"]);
const TEAM_ID_RE = /^[a-z0-9_-]+$/;

interface Body {
  leagueId?: unknown;
  email?: unknown;
  role?: unknown;
  teamId?: unknown;
  playerId?: unknown;
}

export async function POST(req: Request) {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return NextResponse.json(
      { error: "Missing bearer token" },
      { status: 401 },
    );
  }
  const idToken = auth.slice("Bearer ".length).trim();

  let decoded;
  try {
    decoded = await getAdminAuth().verifyIdToken(idToken);
  } catch {
    return NextResponse.json(
      { error: "Invalid or expired token" },
      { status: 401 },
    );
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const leagueId = body.leagueId;
  const email = body.email;
  const role = body.role;
  if (typeof leagueId !== "string" || !leagueId) {
    return NextResponse.json(
      { error: "leagueId is required" },
      { status: 400 },
    );
  }
  if (typeof email !== "string" || !email) {
    return NextResponse.json(
      { error: "email is required" },
      { status: 400 },
    );
  }
  if (typeof role !== "string" || !ALLOWED_ROLES.has(role)) {
    return NextResponse.json(
      {
        error:
          "role must be one of admin | captain | player | remove",
      },
      { status: 400 },
    );
  }

  // Caller authorization — must be admin of this league.
  const callerLeagues = decoded.leagues as Record<string, string> | undefined;
  if (callerLeagues?.[leagueId] !== "admin") {
    return NextResponse.json(
      { error: `Not admin of league "${leagueId}"` },
      { status: 403 },
    );
  }

  // Resolve which claim string to write.
  let claimValue: string | null = null;
  if (role === "admin") {
    claimValue = "admin";
  } else if (role === "captain") {
    if (typeof body.teamId !== "string" || !TEAM_ID_RE.test(body.teamId)) {
      return NextResponse.json(
        { error: "teamId is required for role=captain (lowercase a-z 0-9 - _)" },
        { status: 400 },
      );
    }
    claimValue = `captain:${body.teamId}`;
  } else if (role === "player") {
    if (typeof body.playerId !== "string" || !TEAM_ID_RE.test(body.playerId)) {
      return NextResponse.json(
        { error: "playerId is required for role=player" },
        { status: 400 },
      );
    }
    claimValue = `player:${body.playerId}`;
  } else if (role === "remove") {
    claimValue = null;
  }

  // Look up target.
  const adminAuth = getAdminAuth();
  let user;
  try {
    user = await adminAuth.getUserByEmail(email.toLowerCase());
  } catch {
    return NextResponse.json(
      {
        error:
          `No user found for email "${email}". They need to sign in via magic link at least once before you can grant them a role.`,
      },
      { status: 404 },
    );
  }

  // Self-demote guard — don't let an admin accidentally remove their
  // own admin claim (would lock them out of /admin). They can demote
  // someone else, but not themselves. This is a correctness check,
  // not security; an attacker with admin token could escape it via
  // the script. Helps in normal use.
  if (user.uid === decoded.uid && role !== "admin") {
    return NextResponse.json(
      {
        error:
          "You can't demote yourself. Have another admin demote you, or use the grant-claim script.",
      },
      { status: 400 },
    );
  }

  const existing = (user.customClaims ?? {}) as Record<string, unknown>;
  const existingLeagues =
    (existing.leagues as Record<string, string> | undefined) ?? {};
  const nextLeagues = { ...existingLeagues };
  if (claimValue === null) {
    delete nextLeagues[leagueId];
  } else {
    nextLeagues[leagueId] = claimValue;
  }
  const nextClaims = { ...existing, leagues: nextLeagues };

  await adminAuth.setCustomUserClaims(user.uid, nextClaims);

  return NextResponse.json({
    ok: true,
    uid: user.uid,
    email: user.email,
    leagueId,
    claim: claimValue,
    note:
      claimValue === null
        ? "Claim removed. Token refresh required for the user to lose access."
        : "Claim granted. User will see updated access on next ID-token refresh (~1 hr cache, or immediate if they sign out + back in).",
  });
}
