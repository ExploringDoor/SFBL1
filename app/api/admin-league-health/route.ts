// GET /api/admin-league-health?leagueId=X
//
// Top-of-admin dashboard data: at-a-glance counts so the
// commissioner sees league activity without clicking through every
// section. Counts:
//   - teams (active / total)
//   - players (active / total)
//   - games (total, scheduled, final, postponed)
//   - notification subscribers (devices opted into push)
//   - captains with claims granted vs pending (players with email
//     but no auth_uid linked yet)
//   - last 24h activity (games finalized, schedule edits)
//
// Auth: caller must be admin of leagueId.

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export async function GET(req: Request) {
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

  const url = new URL(req.url);
  const leagueId = url.searchParams.get("leagueId");
  if (!leagueId) {
    return NextResponse.json(
      { error: "leagueId is required" },
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

  const db = getAdminDb();
  const cutoffIso = new Date(Date.now() - ONE_DAY_MS).toISOString();

  // Parallel reads — all small collections, no need to paginate.
  const [
    teamsSnap,
    playersSnap,
    gamesSnap,
    tokensSnap,
    auditSnap,
  ] = await Promise.all([
    db.collection(`leagues/${leagueId}/teams`).get(),
    db.collection(`leagues/${leagueId}/players`).get(),
    db.collection(`leagues/${leagueId}/games`).get(),
    db
      .collection("notification_tokens")
      .where("leagueId", "==", leagueId)
      .get(),
    db
      .collection(`leagues/${leagueId}/audit`)
      .where("at", ">=", cutoffIso)
      .get(),
  ]);

  // Teams
  let teamsActive = 0;
  for (const t of teamsSnap.docs) {
    if (t.data().active !== false) teamsActive++;
  }

  // Players + linked-status (have auth_uid means they've signed in).
  // Email counts come from /_private/contact subdocs (post-PII migration);
  // we batch-fetch in parallel so the dashboard loads in roughly the
  // same time as before.
  const activePlayerDocs = playersSnap.docs.filter(
    (d) => d.data().active !== false,
  );
  let playersActive = activePlayerDocs.length;
  let playersLinked = 0;
  let playersWithEmail = 0;
  const contactDocs = await Promise.all(
    activePlayerDocs.map((d) =>
      db.doc(`leagues/${leagueId}/players/${d.id}/_private/contact`).get(),
    ),
  );
  for (let i = 0; i < activePlayerDocs.length; i++) {
    const data = activePlayerDocs[i]!.data();
    if (typeof data.auth_uid === "string" && data.auth_uid) {
      playersLinked++;
    }
    const contact = contactDocs[i]!.exists ? contactDocs[i]!.data()! : {};
    if (typeof contact.email === "string" && contact.email) {
      playersWithEmail++;
    }
  }

  // Games breakdown
  const gameStatus = {
    total: gamesSnap.size,
    scheduled: 0,
    final: 0,
    postponed: 0,
    cancelled: 0,
    draft: 0,
  };
  let gamesFinalLast24h = 0;
  for (const g of gamesSnap.docs) {
    const data = g.data();
    const status = String(data.status ?? "draft");
    if (status === "scheduled") gameStatus.scheduled++;
    else if (status === "final" || status === "approved") gameStatus.final++;
    else if (status === "postponed") gameStatus.postponed++;
    else if (status === "cancelled") gameStatus.cancelled++;
    else gameStatus.draft++;
    // Recent finals: by last_captain_submit_at if present, else
    // updated_at on the box_score doc (we don't have a fast read for
    // that here — use last_captain_submit_at on game doc only).
    if (
      (status === "final" || status === "approved") &&
      typeof data.updated_at === "string" &&
      data.updated_at >= cutoffIso
    ) {
      gamesFinalLast24h++;
    }
  }

  // Notification subscribers (per-device, not per-user — a captain
  // with two phones counts as 2). Categories opted in for context.
  const subscribers = {
    devices: tokensSnap.size,
    captain_authed: 0,
    admin: 0,
  };
  for (const t of tokensSnap.docs) {
    const data = t.data();
    if (data.is_captain_authed === true) subscribers.captain_authed++;
    if (data.is_admin === true) subscribers.admin++;
  }

  // Recent activity (last 24h)
  const recentByKind: Record<string, number> = {};
  for (const a of auditSnap.docs) {
    const kind = String(a.data().kind ?? "unknown");
    recentByKind[kind] = (recentByKind[kind] ?? 0) + 1;
  }

  // Pending form submissions — registrations + waivers the public site
  // posted that no one has acted on yet (status missing/"new"). Lives at
  // /form_submissions/{kind}/items. Surfaced so Nelson sees new ones
  // even before email notifications are turned on (Adam, 2026-06).
  const FORM_KINDS = [
    "player_registration",
    "team_registration",
    "team_waiver",
    "umpire_evaluation",
  ] as const;
  const formSnaps = await Promise.all(
    FORM_KINDS.map((k) =>
      db.collection(`leagues/${leagueId}/form_submissions/${k}/items`).get(),
    ),
  );
  const pendingForms: Record<string, number> = {};
  let pendingTotal = 0;
  FORM_KINDS.forEach((k, i) => {
    let n = 0;
    for (const d of formSnaps[i]!.docs) {
      if (String(d.data().status ?? "new") === "new") n++;
    }
    pendingForms[k] = n;
    pendingTotal += n;
  });
  pendingForms.total = pendingTotal;

  // Site visits — the public ViewTracker bumps
  // analytics/page_views { total, days: { YYYY-MM-DD } }. Surface total,
  // today, and the 7 most-recent days (Adam, 2026-06).
  const viewsDoc = await db
    .doc(`leagues/${leagueId}/analytics/page_views`)
    .get();
  const viewsData = viewsDoc.exists ? viewsDoc.data() : null;
  const days = (viewsData?.days ?? {}) as Record<string, number>;
  const todayKey = (() => {
    try {
      return new Date().toLocaleDateString("en-CA", {
        timeZone: "America/New_York",
      });
    } catch {
      return new Date().toISOString().slice(0, 10);
    }
  })();
  const recentDayKeys = Object.keys(days).sort().reverse();
  const siteVisits = {
    total: typeof viewsData?.total === "number" ? viewsData.total : 0,
    today: days[todayKey] ?? 0,
    last7: recentDayKeys
      .slice(0, 7)
      .reduce((s, k) => s + (days[k] ?? 0), 0),
  };

  return NextResponse.json({
    ok: true,
    leagueId,
    teams: {
      active: teamsActive,
      total: teamsSnap.size,
    },
    players: {
      active: playersActive,
      total: playersSnap.size,
      with_email: playersWithEmail,
      linked_to_auth: playersLinked, // signed in at least once
    },
    games: gameStatus,
    games_final_last_24h: gamesFinalLast24h,
    subscribers,
    recent_activity: {
      window_hours: 24,
      by_kind: recentByKind,
      total: auditSnap.size,
    },
    pending_forms: pendingForms,
    site_visits: siteVisits,
  });
}
