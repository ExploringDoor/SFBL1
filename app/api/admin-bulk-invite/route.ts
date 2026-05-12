// /api/admin-bulk-invite — admin generates sign-in links + grants
// captain claims for a batch of captains in one call.
//
// Each row in the request maps to a captain to invite:
//   { email: "captain@…", teamId: "margate-marlins" }
//
// For each row we:
//   1. Find or create the Firebase Auth user (idempotent — re-running
//      the same payload doesn't create duplicates).
//   2. Set their `leagues.{leagueId}` claim to `captain:{teamId}`,
//      preserving any other league claims they already have.
//   3. Generate a sign-in-with-email-link they can click ONCE to land
//      on the site signed in.
//
// Response is a parallel array of {email, status, magicLink?, error?}
// so the admin UI can render success/failure per row + give Nelson
// copy-paste-able links to email out via his own client.
//
// Why this isn't auto-emailed: we don't yet have email-sending
// infrastructure (no SES / SendGrid / Mailgun). For SFBL launch
// Nelson copies the links and pastes into Gmail / his email tool.
// Post-launch we wire SES and the same endpoint becomes fire-and-
// forget.

import { NextResponse } from "next/server";
import {
  getAdminAuth,
  getAdminDb,
} from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const maxDuration = 60;

const TEAM_ID_RE = /^[a-z0-9_-]+$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_BATCH = 100;

interface InviteRow {
  email: string;
  teamId: string;
}

export async function POST(req: Request) {
  const authHdr = req.headers.get("authorization");
  if (!authHdr?.startsWith("Bearer ")) {
    return NextResponse.json(
      { error: "Missing bearer token" },
      { status: 401 },
    );
  }
  const idToken = authHdr.slice("Bearer ".length).trim();

  let decoded;
  try {
    // checkRevoked=true: bulk-grants captain claims to every emailed
    // recipient — high-trust mutation, no stale-token window.
    decoded = await getAdminAuth().verifyIdToken(idToken, true);
  } catch {
    return NextResponse.json(
      { error: "Invalid or expired token" },
      { status: 401 },
    );
  }

  let body: {
    leagueId?: unknown;
    invites?: unknown;
    continueUrl?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const leagueId = body.leagueId;
  if (typeof leagueId !== "string" || !leagueId) {
    return NextResponse.json(
      { error: "leagueId is required" },
      { status: 400 },
    );
  }
  if (
    (decoded.leagues as Record<string, string> | undefined)?.[leagueId] !==
    "admin"
  ) {
    return NextResponse.json(
      { error: `Not admin of league "${leagueId}"` },
      { status: 403 },
    );
  }

  if (!Array.isArray(body.invites)) {
    return NextResponse.json(
      { error: "invites must be an array of {email, teamId}" },
      { status: 400 },
    );
  }
  if (body.invites.length > MAX_BATCH) {
    return NextResponse.json(
      { error: `Too many invites (max ${MAX_BATCH} per batch)` },
      { status: 400 },
    );
  }

  // Where the magic link drops the user after sign-in. Defaults to
  // /captain so they land on their portal. Falls back to the request
  // origin if no continueUrl override.
  const fallbackOrigin = (() => {
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    if (!host) return "https://example.com";
    const proto = req.headers.get("x-forwarded-proto") ?? "https";
    return `${proto}://${host}`;
  })();
  const continueUrl =
    typeof body.continueUrl === "string" && body.continueUrl
      ? body.continueUrl
      : `${fallbackOrigin}/login/finish`;

  const auth = getAdminAuth();
  const db = getAdminDb();

  // Validate team ids first — fail fast if a row points at a team
  // that doesn't exist (typo). One Firestore read up front beats
  // failing per-row and confusing the admin.
  const teamIds = new Set<string>();
  for (const raw of body.invites) {
    const r = raw as Partial<InviteRow>;
    if (typeof r.teamId === "string") teamIds.add(r.teamId);
  }
  const teamSnaps = await Promise.all(
    Array.from(teamIds).map((tid) =>
      db.doc(`leagues/${leagueId}/teams/${tid}`).get(),
    ),
  );
  const validTeamIds = new Set(
    teamSnaps.filter((s) => s.exists).map((s) => s.id),
  );

  type Result = {
    email: string;
    teamId: string;
    status: "ok" | "error";
    magicLink?: string;
    error?: string;
  };
  const results: Result[] = [];

  for (const raw of body.invites) {
    const r = raw as Partial<InviteRow>;
    const email =
      typeof r.email === "string" ? r.email.trim().toLowerCase() : "";
    const teamId = typeof r.teamId === "string" ? r.teamId.trim() : "";
    if (!EMAIL_RE.test(email)) {
      results.push({
        email,
        teamId,
        status: "error",
        error: "Invalid email",
      });
      continue;
    }
    if (!TEAM_ID_RE.test(teamId)) {
      results.push({
        email,
        teamId,
        status: "error",
        error: "Invalid team_id",
      });
      continue;
    }
    if (!validTeamIds.has(teamId)) {
      results.push({
        email,
        teamId,
        status: "error",
        error: `Team "${teamId}" doesn't exist in this league`,
      });
      continue;
    }

    try {
      // 1. Find or create the user.
      let user;
      try {
        user = await auth.getUserByEmail(email);
      } catch (e) {
        const code = (e as { code?: string }).code;
        if (code === "auth/user-not-found") {
          user = await auth.createUser({ email });
        } else {
          throw e;
        }
      }

      // 2. Set custom claims, preserving existing leagues map.
      const existing =
        (user.customClaims?.leagues as Record<string, string> | undefined) ??
        {};
      const updated = { ...existing, [leagueId]: `captain:${teamId}` };
      await auth.setCustomUserClaims(user.uid, {
        ...(user.customClaims ?? {}),
        leagues: updated,
      });

      // 3. Generate the sign-in link.
      const link = await auth.generateSignInWithEmailLink(email, {
        url: continueUrl,
        handleCodeInApp: true,
      });

      results.push({ email, teamId, status: "ok", magicLink: link });
    } catch (e) {
      results.push({
        email,
        teamId,
        status: "error",
        error: e instanceof Error ? e.message : "Unknown error",
      });
    }
  }

  // Audit a single row for the batch — individual rows aren't
  // separately interesting at the audit-log level.
  await db.collection(`leagues/${leagueId}/audit`).add({
    kind: "bulk_invite",
    by_uid: decoded.uid,
    by_role: "admin",
    changes: {
      total: results.length,
      ok: results.filter((r) => r.status === "ok").length,
      errors: results.filter((r) => r.status === "error").length,
    },
    at: new Date().toISOString(),
  });

  return NextResponse.json({ ok: true, results });
}
