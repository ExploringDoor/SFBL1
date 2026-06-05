// POST /api/admin-team — admin creates / updates / deletes a team
// metadata doc on the active league.
//
// Body shape:
//   { leagueId, action: 'create' | 'update' | 'delete', teamId, ... }
//
// Why a dedicated endpoint vs a generic doc-write: same reasoning as
// /api/admin-branding — branding-shape mutations from a UI need
// validation that the schema doesn't enforce on its own (color hex
// format, abbrev length, etc.) and we don't want to widen rules to
// allow arbitrary client writes to /teams.
//
// Authority: caller must be admin of leagueId. Captains can edit
// their own roster via /api/captain-roster, but team metadata
// (name, color, abbrev) is admin-only — captains shouldn't rename
// each other or recolor logos.

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";
import { cleanName } from "@/lib/text";

export const runtime = "nodejs";

const TEAM_ID_RE = /^[a-z0-9_-]+$/;
const HEX_COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;

interface Body {
  leagueId?: unknown;
  action?: unknown;
  teamId?: unknown;
  name?: unknown;
  abbrev?: unknown;
  color?: unknown;
  division?: unknown;
  logo_url?: unknown;
  // Per-team captain/manager password. Stored on the PRIVATE
  // teams/{id}/_private/auth subdoc (the public team doc is
  // world-readable, so a password there would leak). Empty/omitted
  // string = leave the existing password unchanged.
  captain_password?: unknown;
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
  const action = body.action;
  if (typeof leagueId !== "string" || !leagueId) {
    return NextResponse.json(
      { error: "leagueId is required" },
      { status: 400 },
    );
  }
  if (action !== "create" && action !== "update" && action !== "delete") {
    return NextResponse.json(
      { error: "action must be one of create | update | delete" },
      { status: 400 },
    );
  }

  const callerLeagues = decoded.leagues as
    | Record<string, string>
    | undefined;
  if (callerLeagues?.[leagueId] !== "admin") {
    return NextResponse.json(
      { error: `Not admin of league "${leagueId}"` },
      { status: 403 },
    );
  }

  const teamId = body.teamId;
  if (typeof teamId !== "string" || !TEAM_ID_RE.test(teamId)) {
    return NextResponse.json(
      {
        error:
          "teamId is required (lowercase letters/numbers, with - or _)",
      },
      { status: 400 },
    );
  }

  const db = getAdminDb();
  const ref = db.doc(`leagues/${leagueId}/teams/${teamId}`);

  if (action === "delete") {
    // Soft delete — preserves historical box scores + standings.
    // True hard delete would orphan past games' team_id references.
    await ref.set(
      {
        active: false,
        deactivated_at: new Date().toISOString(),
        deactivated_by_uid: decoded.uid,
      },
      { merge: true },
    );
    return NextResponse.json({ ok: true, soft_deleted: true });
  }

  // Build the writeable payload — same fields for create + update.
  const update: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) {
    if (body.name.length > 80) {
      return NextResponse.json(
        { error: "name too long (80 char max)" },
        { status: 400 },
      );
    }
    update.name = cleanName(body.name);
  }
  if (typeof body.abbrev === "string") {
    if (body.abbrev.length > 8) {
      return NextResponse.json(
        { error: "abbrev too long (8 char max)" },
        { status: 400 },
      );
    }
    update.abbrev = body.abbrev.trim().toUpperCase();
  }
  if (typeof body.color === "string" && body.color) {
    if (!HEX_COLOR_RE.test(body.color)) {
      return NextResponse.json(
        { error: "color must be hex (e.g. #002d72)" },
        { status: 400 },
      );
    }
    update.color = body.color;
  } else if (body.color === "" || body.color === null) {
    update.color = null;
  }
  if (typeof body.division === "string") {
    update.division = body.division.trim() || null;
  }
  if (typeof body.logo_url === "string") {
    const v = body.logo_url.trim();
    if (
      v === "" ||
      v.startsWith("/") ||
      v.startsWith("https://") ||
      v.startsWith("http://")
    ) {
      update.logo_url = v || null;
    } else {
      return NextResponse.json(
        {
          error:
            "logo_url must start with /, https://, or http:// (or empty)",
        },
        { status: 400 },
      );
    }
  }

  // Captain/manager password — written to the PRIVATE subdoc (below),
  // never the public team doc. A non-empty string sets/replaces it
  // and stamps a non-secret `has_captain_password: true` flag on the
  // public doc so the admin UI can show "password set" without
  // reading the secret. Empty/omitted = leave unchanged. Parsed here
  // (before the empty-update guard) so a password-only edit counts
  // as a change.
  let setCaptainPassword: string | null = null;
  if (typeof body.captain_password === "string") {
    const pw = body.captain_password.trim();
    if (pw) {
      if (pw.length > 128) {
        return NextResponse.json(
          { error: "captain_password too long (128 char max)" },
          { status: 400 },
        );
      }
      setCaptainPassword = pw;
      update.has_captain_password = true;
    }
  }

  if (action === "create") {
    if (!update.name) {
      return NextResponse.json(
        { error: "name is required for create" },
        { status: 400 },
      );
    }
    // Don't overwrite an existing team.
    const existing = await ref.get();
    if (existing.exists) {
      return NextResponse.json(
        { error: `Team "${teamId}" already exists. Use action=update.` },
        { status: 409 },
      );
    }
    update.active = true;
    update.created_at = new Date().toISOString();
    update.created_by_uid = decoded.uid;
  } else {
    // update — must already exist.
    const existing = await ref.get();
    if (!existing.exists) {
      return NextResponse.json(
        { error: `Team "${teamId}" not found. Use action=create.` },
        { status: 404 },
      );
    }
    if (Object.keys(update).length === 0) {
      return NextResponse.json(
        { error: "No fields to update" },
        { status: 400 },
      );
    }
    update.updated_at = new Date().toISOString();
    update.updated_by_uid = decoded.uid;
  }

  await ref.set(update, { merge: true });

  if (setCaptainPassword !== null) {
    await db
      .doc(`leagues/${leagueId}/teams/${teamId}/_private/auth`)
      .set(
        {
          captain_password: setCaptainPassword,
          updated_at: new Date().toISOString(),
          updated_by_uid: decoded.uid,
        },
        { merge: true },
      );
  }

  return NextResponse.json({ ok: true, action, teamId });
}
