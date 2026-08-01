// GET /api/health — liveness + dependency check for an external uptime
// monitor (UptimeRobot, BetterStack, Pingdom).
//
// Why this exists: the audit found nothing was watching the site. A broken
// deploy or a Firestore outage would only surface when a coach complained.
// Monitoring the homepage is not enough either — Next can serve a cached
// shell while the database behind it is unreachable, so this endpoint
// actually touches Firestore and fails loudly when it can't.
//
// Contract for the monitor: alert on any non-200. 200 means the app is
// serving AND its database is reachable for the resolved tenant.
//
// Deliberately returns no tenant data, no counts, and no config — it is a
// public endpoint, so it must not become an unauthenticated data source.

import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getAdminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = Date.now();
  const tenantId = headers().get("x-tenant-id");

  try {
    // Cheapest meaningful read: the tenant's own config doc (one document).
    // Falls back to a bare collection ping when the host isn't a tenant.
    const db = getAdminDb();
    if (tenantId) {
      const snap = await db.doc(`leagues/${tenantId}`).get();
      if (!snap.exists) {
        return NextResponse.json(
          { ok: false, error: "tenant config missing", tenant: tenantId },
          { status: 503, headers: { "cache-control": "no-store" } },
        );
      }
    } else {
      await db.collection("leagues").limit(1).get();
    }

    return NextResponse.json(
      {
        ok: true,
        tenant: tenantId ?? null,
        firestore: "reachable",
        ms: Date.now() - startedAt,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        tenant: tenantId ?? null,
        firestore: "unreachable",
        error: e instanceof Error ? e.message : "unknown",
        ms: Date.now() - startedAt,
      },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
