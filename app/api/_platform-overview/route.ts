// GET /api/_platform-overview — platform-admin-only data feed for /_platform.
//
// Returns:
//   - tenants[]: every league doc with slug, name, sport, billing
//     status, team count, player count, last write timestamp
//   - errors[]:  the most recent 50 entries from the platform-wide
//     /errors collection
//
// Auth: bearer token. Caller's UID must be in PLATFORM_ADMIN_UIDS env
// var. Per-tenant `admin` claim is NOT enough — this endpoint shows
// data across every tenant, so it gates on the platform admin list.
//
// Why server-side: /errors is server-only-read at the rules layer
// (firestore.rules:367 — read: false), and /leagues is public but we
// want consistent shapes + cross-tenant aggregation in one round trip.

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";
import { isPlatformAdmin } from "@/lib/platform-auth";

export const runtime = "nodejs";

interface TenantOverview {
  slug: string;
  name: string;
  sport: string | null;
  billing_status: string | null;
  paid_through: string | null;
  team_count: number;
  player_count: number;
  game_count: number;
  // ISO timestamp of the most recent write we know about. Best-effort
  // from the league doc's updated_at; null if never updated.
  last_activity_at: string | null;
}

interface ErrorRow {
  id: string;
  at: string | null;
  message: string;
  leagueId: string | null;
  url: string | null;
  uid: string | null;
}

interface OverviewPayload {
  tenants: TenantOverview[];
  errors: ErrorRow[];
}

export async function GET(req: Request) {
  // 1) Auth ─────────────────────────────────────────────────────
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

  // 2) Platform admin gate ──────────────────────────────────────
  if (!isPlatformAdmin(decoded.uid)) {
    return NextResponse.json(
      { error: "Not a platform admin" },
      { status: 403 },
    );
  }

  // 3) Load tenants + counts ────────────────────────────────────
  const db = getAdminDb();
  const leaguesSnap = await db.collection("leagues").get();

  // Run team / player / game counts per tenant in parallel.
  const tenants: TenantOverview[] = await Promise.all(
    leaguesSnap.docs.map(async (d): Promise<TenantOverview> => {
      const data = d.data() ?? {};
      const slug = d.id;
      const billing = (data.billing as Record<string, unknown>) ?? {};
      const [teamsSnap, playersSnap, gamesSnap] = await Promise.all([
        db.collection(`leagues/${slug}/teams`).get(),
        db.collection(`leagues/${slug}/players`).get(),
        db.collection(`leagues/${slug}/games`).get(),
      ]);
      return {
        slug,
        name: String(data.name ?? slug),
        sport: data.sport ? String(data.sport) : null,
        billing_status: billing.status ? String(billing.status) : null,
        paid_through: billing.paid_through
          ? String(billing.paid_through)
          : null,
        team_count: teamsSnap.size,
        player_count: playersSnap.size,
        game_count: gamesSnap.size,
        last_activity_at: data.updated_at ? String(data.updated_at) : null,
      };
    }),
  );

  tenants.sort((a, b) => a.slug.localeCompare(b.slug));

  // 4) Load recent errors ───────────────────────────────────────
  // Sort by `at` descending if present, fall back to insertion order.
  const errorsSnap = await db.collection("errors").get();
  const errorRows: ErrorRow[] = errorsSnap.docs.map((d) => {
    const data = d.data() ?? {};
    return {
      id: d.id,
      at: data.at ? String(data.at) : null,
      message: String(data.message ?? data.error ?? "(no message)"),
      leagueId: data.leagueId ? String(data.leagueId) : null,
      url: data.url ? String(data.url) : null,
      uid: data.uid ? String(data.uid) : null,
    };
  });
  errorRows.sort((a, b) => {
    // Newest first; missing `at` sorts to the end.
    if (a.at && b.at) return b.at.localeCompare(a.at);
    if (a.at && !b.at) return -1;
    if (!a.at && b.at) return 1;
    return 0;
  });

  const payload: OverviewPayload = {
    tenants,
    errors: errorRows.slice(0, 50),
  };
  return NextResponse.json(payload);
}
