// POST /api/register-notification-token — register or update an FCM push
// subscription for the signed-in user, scoped to a specific league.
//
// Multi-tenant requirement: every notification_tokens doc carries a
// `leagueId` field, and the doc id is `<token>_<leagueId>`. This is
// the deviation from DVSL's auto-id + where-query upsert pattern.
// The /api/send-notification filter chain joins on leagueId before any
// other filter runs, so a captain registered for SFBL never receives a
// push triggered by a KCSL event (covered by the cross-tenant rules
// test in tests/integration/notification-tenant-isolation.test.ts).
//
// All trusted fields are server-derived — the client cannot forge:
//   - leagueId           : pulled from the verified ID-token claim
//   - is_admin           : pulled from `leagues[leagueId] === 'admin'`
//                          OR (legacy fallback) the player doc's
//                          `is_admin === true` flag (DVSL pattern at
//                          notifications.html:1147-1186)
//   - is_captain_authed  : pulled from `leagues[leagueId]` claim
//                          starting with `captain:`
//   - authed_teams       : derived from claim + matching player docs
//                          on this league. Re-derived on every call
//                          (FULL REPLACEMENT — drop on the way out,
//                          not just add on the way in, otherwise stale
//                          rosters cause ghost-team pushes).
//   - auth_uid           : decoded.uid
//   - player_id          : single linked player doc id (best match)
//
// Client-supplied fields (subscription prefs):
//   - categories : string[]  (only ALL_CATEGORIES allowed)
//   - teams      : string[]  (user-picked subscription set; [] = all)
//
// Body shape:
//   { leagueId, token, categories?, teams? }
//
// On first register the categories/teams default to DEFAULT_CATEGORIES /
// [] respectively. Subsequent calls treat omitted fields as "don't change".
//
// Doc id: `${token}_${leagueId}`. setDoc with merge so register-time
// fields don't clobber prefs the user later updated, and prefs updates
// don't clobber server-derived trust fields.

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";
import {
  ALL_CATEGORIES_SET,
  DEFAULT_CATEGORIES,
  type NotificationCategory,
} from "@/lib/notifications/categories";

export const runtime = "nodejs";

interface RegisterBody {
  leagueId?: unknown;
  token?: unknown;
  categories?: unknown;
  teams?: unknown;
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

  let body: RegisterBody;
  try {
    body = (await req.json()) as RegisterBody;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const leagueId = body.leagueId;
  const token = body.token;
  if (typeof leagueId !== "string" || !leagueId) {
    return NextResponse.json(
      { error: "Body must include { leagueId }" },
      { status: 400 },
    );
  }
  if (typeof token !== "string" || !token) {
    return NextResponse.json(
      { error: "Body must include { token }" },
      { status: 400 },
    );
  }
  // Slashes/whitespace in tokens would break our doc-id convention. FCM
  // tokens never contain them but verify defensively — a tampered body
  // could otherwise reach into another doc path.
  if (/[\s/]/.test(token)) {
    return NextResponse.json(
      { error: "Invalid token format" },
      { status: 400 },
    );
  }

  // Validate user-supplied prefs before we mix them with trusted fields.
  let categoriesPatch: NotificationCategory[] | null = null;
  if (body.categories !== undefined) {
    if (!Array.isArray(body.categories)) {
      return NextResponse.json(
        { error: "categories must be an array of strings" },
        { status: 400 },
      );
    }
    const filtered = body.categories.filter(
      (c): c is NotificationCategory =>
        typeof c === "string" && ALL_CATEGORIES_SET.has(c),
    );
    // Dedupe — preserves order, picks first occurrence.
    categoriesPatch = Array.from(new Set(filtered));
  }
  let teamsPatch: string[] | null = null;
  if (body.teams !== undefined) {
    if (!Array.isArray(body.teams)) {
      return NextResponse.json(
        { error: "teams must be an array of strings" },
        { status: 400 },
      );
    }
    teamsPatch = Array.from(
      new Set(body.teams.filter((t): t is string => typeof t === "string")),
    );
  }

  // ── Trusted fields, all server-derived ──────────────────────────────
  const leagues = decoded.leagues as Record<string, string> | undefined;
  const claim = leagues?.[leagueId];
  const isAdminFromClaim = claim === "admin";
  const isCaptainAuthed =
    typeof claim === "string" && claim.startsWith("captain:");
  const claimTeamId = isCaptainAuthed ? claim.slice("captain:".length) : null;

  const db = getAdminDb();

  // Re-derive `authed_teams` as the full replacement of which teams in
  // THIS league the user is authenticated against. Captain claim → that
  // team. Linked player docs → their team_id. We also pick a `player_id`
  // (best single match) for excludePlayerIds + rosterOnly filters in the
  // send endpoint.
  const teamSet = new Set<string>();
  let primaryPlayerId: string | null = null;
  if (claimTeamId) teamSet.add(claimTeamId);

  // Find player records linked to this auth user in this league.
  const playerByUidSnap = await db
    .collection(`leagues/${leagueId}/players`)
    .where("auth_uid", "==", decoded.uid)
    .get();
  for (const d of playerByUidSnap.docs) {
    const p = d.data();
    if (p.active === false) continue;
    if (p.team_id) teamSet.add(String(p.team_id));
    if (!primaryPlayerId) primaryPlayerId = d.id;
  }

  // Fallback: legacy DVSL-style is_admin flag on the player doc when the
  // user has no `admin` claim (notifications.html:1147-1186 pattern).
  let isAdminFromPlayer = false;
  if (!isAdminFromClaim && primaryPlayerId) {
    const playerDoc = await db
      .doc(`leagues/${leagueId}/players/${primaryPlayerId}`)
      .get();
    if (playerDoc.exists && playerDoc.data()?.is_admin === true) {
      isAdminFromPlayer = true;
    }
  }
  const isAdmin = isAdminFromClaim || isAdminFromPlayer;

  const docId = `${token}_${leagueId}`;
  const ref = db.doc(`notification_tokens/${docId}`);
  const existing = await ref.get();
  const now = new Date().toISOString();

  // Build the write. Trusted fields always rewritten. Prefs only
  // touched when the caller supplied them; on first register supply
  // defaults so the doc is functional immediately.
  const update: Record<string, unknown> = {
    token,
    leagueId,
    auth_uid: decoded.uid,
    is_admin: isAdmin,
    is_captain_authed: isCaptainAuthed,
    authed_teams: Array.from(teamSet).sort(),
    player_id: primaryPlayerId,
    updated_at: now,
  };

  if (!existing.exists) {
    update.created_at = now;
    update.categories = categoriesPatch ?? DEFAULT_CATEGORIES;
    update.teams = teamsPatch ?? [];
  } else {
    if (categoriesPatch !== null) update.categories = categoriesPatch;
    if (teamsPatch !== null) update.teams = teamsPatch;
  }

  await ref.set(update, { merge: true });

  return NextResponse.json({
    ok: true,
    docId,
    is_admin: isAdmin,
    is_captain_authed: isCaptainAuthed,
    authed_teams: update.authed_teams,
    player_id: primaryPlayerId,
  });
}
