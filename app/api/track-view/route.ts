// POST /api/track-view — bump the per-league site-visit counter
// (Adam, 2026-06). Public, no auth: the client ViewTracker fires it
// once per browser session. Tenant resolved from Host. Stored at
// leagues/{id}/analytics/page_views as { total, days: { YYYY-MM-DD } }.
// Best-effort + rate-limited; never blocks or errors a page.

import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase-admin";
import { parseHost, resolveTenant } from "@/lib/tenants";

// Per-IP throttle so the endpoint can't be spammed to inflate the count.
const rate = new Map<string, { count: number; reset: number }>();
const LIMIT = 20;
const WINDOW_MS = 60_000;

// "Today" in Eastern time — league sites are US-based, so this keeps the
// day boundary close to the commissioner's day for the per-day buckets.
function easternDayKey(): string {
  try {
    return new Date().toLocaleDateString("en-CA", {
      timeZone: "America/New_York",
    });
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export async function POST() {
  const h = headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const tenant = await resolveTenant(parseHost(host));
  const tenantId = tenant?.id;
  if (!tenantId) return NextResponse.json({ ok: true });

  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const now = Date.now();
  const e = rate.get(ip);
  if (e && now < e.reset) {
    if (e.count >= LIMIT) return NextResponse.json({ ok: true });
    e.count++;
  } else {
    rate.set(ip, { count: 1, reset: now + WINDOW_MS });
  }

  try {
    const day = easternDayKey();
    await getAdminDb()
      .doc(`leagues/${tenantId}/analytics/page_views`)
      .set(
        {
          total: FieldValue.increment(1),
          days: { [day]: FieldValue.increment(1) },
          updated_at: new Date().toISOString(),
        },
        { merge: true },
      );
  } catch {
    // Analytics must never break the site.
  }
  return NextResponse.json({ ok: true });
}
